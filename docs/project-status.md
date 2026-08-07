# Project Status

Tracked against the In-House Customizable ATS PRD, benchmarked against Zoho Recruit, Ceipal,
and Zimyo. PRD requirements are tagged `M` (committed for v1) or `P2`/`Future` (later phase);
section numbers below refer to the PRD.

## Completed modules

### Module 1 — Foundation, Auth & RBAC, Customization Engine

Covers PRD §10 (Customization Engine) and §11.13 (Roles, Permissions & Admin Settings):

- Email/password authentication (Auth.js v5, JWT sessions), server-side route protection.
- Admin-defined roles and `(resource, action, scope)` permission grants, enforced server-side.
- Field-level permission rules, independent of entity-level grants.
- Custom Fields (§10.1) on any registered entity, and Custom Objects (§10.1) with no dedicated
  table per object.
- Controlled lists, an audit log searchable by user/entity/date range (§11.13), and
  organization-level working days/hours (foundation for future SLA/TAT clocks).

### Module 2 — Requisition / Job Management (PRD §11.1)

All `M`-priority requirements from §11.1 are implemented:

- Create a job with title, department, employment type, positions count, location, target
  date, priority. ✅
- Configurable-workflow-shaped approval flow before a job opens for sourcing (draft → pending
  approval → open) — built as a **simple, fixed** state machine per Phase 1's explicit scope
  decision; the fully configurable workflow builder is deferred to the PRD's Workflow &
  Automation Builder (§10.2). ✅ (scoped)
- Assign one or more recruiters, with a primary owner. ✅
- Status: open, on hold, closed, cancelled — reason required on hold/close/cancel. ✅
- Attach job description and structured must-have/good-to-have criteria (stored as string
  lists, not free text, per Phase 1). ✅
- Positions-filled counter, present and defaulted to `0`, **not yet auto-updating** — no
  module through Module 2 writes to it; it becomes live once an Application/Offer module
  exists to drive it. Aging indicator (from `createdAt`) is not yet built as a UI affordance.
  ⚠️ partial, see [Known limitations](#known-limitations).
- Link a job to a parent requisition where one need splits into multiple roles. ✅
- Clone a closed job into a new requisition — tagged `P2` in the PRD, not built. ⏸ deferred

### Module 3 — Candidate Database (PRD §11.2)

All `M`-priority requirements from §11.2 are implemented:

- Create/edit/view candidate records: name, phone, email, location, current/expected
  compensation, notice period, earliest availability, total experience, skills, tags,
  structured experience and education history, and a Controlled List source. ✅
- Unique-key duplicate detection on phone (hard block, `409`, with a link to the existing
  record) and a secondary email signal (never blocks, surfaced as `possibleDuplicateOf`). ✅
- Merge two candidate records, filling only empty target fields and reassigning documents and
  notes to the surviving record. ✅
- Attach documents (resume, cover letter, etc.) to a candidate record, with type, size, and
  MIME-type validation. ✅
- A per-candidate timeline of notes, built on an item-type contract designed for future modules
  (Application, Interview, Offer, Communication Hub) to extend without a contract change. ✅
- Bulk import via CSV/XLSX with a stateless preview (validate without writing) → commit
  (create, re-validating and re-checking duplicates server-side) flow. ✅
- Bulk export of the caller's visible candidates as CSV/XLSX, reusing the read permission and
  scope filter rather than a separate export permission. ✅
- GDPR-aligned consent capture (§13): `consentGivenAt` is required at creation and never
  fabricated by import. ✅
- Custom fields on Candidates via the existing Customization Engine, no new engine code. ✅
- Resume auto-parsing / structured-data extraction from an uploaded file — tagged under the
  PRD's AI & Automation Assistant (§11.11, "Future — Differentiated/Niche"), not built. ⏸
  deferred (see [Known limitations](#known-limitations))
- A column-mapping UI for bulk import (matching arbitrary source-file headers to Candidate
  fields) — not required by §11.2's stated scope; the current import instead expects a fixed
  set of case-insensitive column names. ⚠️ partial, see
  [Known limitations](#known-limitations)

### Module 4 — Applications / Candidate Pipeline (PRD §11.4)

All `M`-priority requirements from §11.4 are implemented:

- Link a candidate to a job as an `Application`, tracking which stage of the pipeline they're
  in. ✅
- Per-job configurable pipeline stages (add/rename/reorder/deactivate/reactivate), with every new
  job starting from a default four-stage pipeline (Applied, Screening, Interview, Offer). ✅
- Move an application between stages, in any order — an unrestricted any-stage-to-any-stage
  transition, not a fixed forward-only sequence. ✅
- Reject or withdraw an application, each a terminal outcome requiring a reason, independent of
  and never resetting the stage it happened at. ✅
- Kanban-style board view (drag-and-drop, one column per active stage) and a list view, sharing
  one dataset per job. ✅
- Bulk actions — stage move, reject, withdraw, and queue an email — across multiple selected
  applications at once, with per-item best-effort success/failure reporting. ✅
- Warn (never block) when re-adding a candidate previously in the pipeline for the same job. ✅
- A dedicated, independently reassignable application owner, defaulting from the job's primary
  recruiter. ✅
- The candidate timeline (Module 3) now surfaces application activity alongside notes, via the
  same extensible item-type contract. ✅
- Custom fields on Applications via the existing Customization Engine, no new engine code. ✅
- Bulk email — **infrastructure only**: renders a template and logs what would be sent
  (`ApplicationEmailLog`, status always `PENDING`); real delivery is scoped to the PRD's
  Communication Hub module (§11.10), a later module, per the Phase 2 decision. ⏸ deferred
  (queued-only by design, not a gap — see [Known limitations](#known-limitations))
- Interview scheduling, feedback capture, and offer generation are explicitly out of scope for
  this module — they belong to the PRD's Interview Management (§11.5) and Offer Management
  (§11.6) modules, not yet started. ⏸ deferred

## Completed phases (Module 2)

1. **Requirements Analysis** — approved decisions: simple approval workflow (not the full
   builder), a dedicated `APPROVE` permission action, read-only auto-maintained
   positions-filled counter, Controlled Lists for department/location/hold/close/cancel
   reasons, no hard delete, flexible parent/child linking, structured criteria lists.
2. **Technical Design** — schema, service-layer, and API design; approved with additions
   (job code, hiring manager field, salary fields, optimistic locking) that were **later
   reverted** in the PRD-alignment refinement below.
3. **Backend Implementation** — `Job`/`JobRecruiterAssignment`/`JobStatusChange` schema,
   `JobService`, thin API routes, seed data, automated tests.
4. **PRD-alignment refinement** (ad hoc, between Phases 3 and 4) — removed `code`,
   `sequenceNumber`, `hiringManagerId`, and all salary fields from `Job`, since none are named
   in the PRD's §11.1 requirements and they either expanded the data model or introduced
   user-facing functionality beyond it. Ownership for every Job action, including
   `APPROVE`/`REJECT`, was redesigned to resolve uniformly against `primaryRecruiterId`.
   `version` (optimistic locking) was kept, as a purely internal implementation detail with no
   user-facing surface.
5. **Frontend Implementation** — job list with filters/search, create/edit form, detail page
   with status-action buttons and a recruiter editor, all permission-gated in the nav and on
   each control.
6. **Testing** — manual + automated (Vitest) coverage of the service layer, validation
   schemas, and the status machine; RBAC/scope testing (OWN/TEAM/ALL); a full curl-driven API
   surface pass; database-integrity and audit-log verification; lint/typecheck/build
   verification. One real bug found and fixed (below).
7. **Documentation** *(this pass)* — README, architecture, database, API, project status, and
   changelog brought in line with the actual implementation.

## Completed phases (Module 3)

1. **Requirements Analysis** — approved decisions: phone as the hard duplicate key (email as a
   soft signal only), ownership resolved against `createdById` (Candidate has no "assigned
   recruiter" field, unlike Job), fill-empty-only merge semantics, a `StorageProvider`
   abstraction with only a local-filesystem implementation for now, an extensible timeline item
   contract, a stateless two-phase (preview/commit) import flow, export reusing the read
   permission rather than a new one, and required (never-fabricated) consent capture.
2. **Technical Design** — `Candidate`/`CandidateDocument`/`CandidateNote` schema, service-layer
   design (`candidates.ts`, `candidate-import.ts`, `candidate-export.ts`), and API surface
   design; ExcelJS selected over SheetJS/`xlsx` for XLSX import/export due to unpatched
   high-severity CVEs in the latter.
3. **Backend Implementation** — schema and migration, `CandidateService` (list/detail/create/
   update/delete/merge/documents/timeline/notes), import preview/commit, export, thin API
   routes, seed data (Candidate permission grants for Recruiter only).
4. **Frontend Implementation** — candidate list with filters/search, create/edit form (with
   experience/education editors and a live duplicate check), detail page with documents,
   timeline, notes, and a merge dialog, and an import wizard, all permission-gated in the nav
   and on each control.
5. **Testing** — automated (Vitest) coverage of the service layer (54 tests) and validation
   schemas (30 tests) — bringing the project total from 55 to 139 automated tests — plus a
   Playwright browser pass covering search/filter behavior, stored-XSS resistance (a candidate
   name containing an `<img onerror>` payload renders as literal text and never executes), and
   RBAC (Hiring Manager and HR / Onboarding, which get no default Candidate grant, see no
   Candidates nav link and are redirected away from `/candidates` routes). Three real bugs
   found and fixed (below, and in [CHANGELOG.md](../CHANGELOG.md)).
6. **Documentation** *(this pass)* — README, architecture, database, API, project status, and
   changelog brought in line with the actual implementation; corrected a pre-existing
   inaccuracy in this documentation set (the `CANDIDATE_SOURCE`/`DOCUMENT_TYPE` controlled
   lists have carried real starter values since Module 1 — the docs previously and incorrectly
   claimed otherwise).

## Completed phases (Module 4)

1. **Requirements Analysis** — approved decisions: a dedicated ordered `PipelineStage`
   configuration model (not an enum, not a Controlled List), unrestricted any-stage-to-any-stage
   transitions, Rejected and Withdrawn as separate terminal outcomes orthogonal to stage, a
   dedicated reassignable `Application.ownerId` defaulting from the job's primary recruiter,
   blocking Candidate deletion when Applications exist, bulk actions limited to stage move/
   reject/withdraw/bulk email, bulk email as infrastructure-only (no real delivery), and a
   rejection reason required only for Rejected/Withdrawn.
2. **Technical Design** — `PipelineStage`/`Application`/`ApplicationEvent`/`ApplicationEmailLog`
   schema, service-layer design (`applications.ts`, `pipeline-stages.ts`), API surface design,
   RBAC model, validation strategy, and migration plan.
3. **Backend Implementation** — schema and migration, `PipelineStageService` (list, full-set
   replace, default-stage seeding), `ApplicationService` (list/detail/create/update/duplicate-
   check/transition/bulk-transition/bulk-email), thin API routes, seed data (Application
   permission grants for Recruiter, Hiring Manager, Recruiting Manager), cross-module wiring
   (`createJob` seeds default stages, `deleteCandidate` blocks on existing applications,
   `getCandidateTimeline` gains four new item types), and a one-time backfill script for
   pre-existing jobs.
4. **Frontend Implementation** — an Applications nav item and global filterable list with row
   selection and a shared bulk-action toolbar; an application create form with candidate/job
   pickers and a non-blocking duplicate warning; an application detail page with owner
   reassignment, single-record transition actions, and stage/outcome history; a per-job Pipeline
   page with Board (a `@dnd-kit/core` Kanban view, isolated to one component) and List tabs
   sharing one dataset; an ordered pipeline-stage editor; and candidate-timeline/cross-link
   integration — all permission-gated in the nav and on each control.
5. **Testing** — automated (Vitest) coverage of the service layer (31 tests across
   `ApplicationService` and `PipelineStageService`) and validation schemas (21 tests) —
   bringing the project total from 139 to 191 automated tests — plus a full curl-driven API
   surface pass (every endpoint's validation, RBAC, optimistic locking, audit logging, terminal-
   outcome and inactive-stage rejection, and duplicate-warning behavior verified live against the
   dev database), a direct database inspection (FKs, cascade/restrict behavior, the new partial
   index, version/event/audit rows), a dedicated Module 1-3 regression pass (zero regressions),
   and a 20-step Playwright end-to-end recruiter workflow — login, job creation with default-
   stage verification, candidate creation, application creation with a live duplicate warning, a
   real pointer-driven board drag, reject/withdraw via the detail page, bulk reject, bulk email,
   candidate-timeline verification, audit-log verification, and a deliberate concurrent-edit
   drag-and-drop rollback scenario. Two real bugs found and fixed (below, and in
   [CHANGELOG.md](../CHANGELOG.md)).
6. **Documentation** *(this pass)* — README, architecture, database, API, project status, and
   changelog brought in line with the actual implementation; corrected a further pre-existing
   inaccuracy in this documentation set (see [Known limitations](#known-limitations) — the
   `REJECTION_REASON`, `JOB_HOLD_REASON`, `JOB_CLOSE_REASON`, and `JOB_CANCEL_REASON` Controlled
   Lists have carried real starter values since Module 1, not "none seeded" as previously and
   incorrectly stated).

## Remaining modules

Per the PRD's §11 module breakdown and §14 roadmap, not yet started:

| PRD § | Module | Roadmap phase |
| --- | --- | --- |
| 11.3 | Sourcing & Job Board Distribution | V1 — Core Parity |
| 11.5 | Interview Management | V1 — Core Parity |
| 11.6 | Offer Management | V1 — Core Parity |
| 11.7 | Onboarding Handoff / HRIS Integration | V1 — Core Parity |
| 11.10 | Communication Hub (email logging, template-driven messaging) | V1 — Core Parity |
| 11.12 | Reporting & Analytics, incl. custom dashboard/report builder (§10.5) | V1 — Core Parity |
| 10.2 | Workflow & Automation Builder (visual, no-code, per-job/pipeline) | *implicit, underlies later V1 modules' configurability* |
| 10.4 | Template Designer (email templates, offer letters, e-signature-ready) | *implicit* |
| 11.8 | Client / Staffing Portal *(optional module)* | P2 — Extended Capability |
| 11.9 | Contingent Workforce & Compliance Tools *(optional module)* | Deferred until a business need is confirmed / Future |
| 11.11 | AI & Automation Assistant (resume parsing, match scoring, summaries, JD drafting, Voice AI) | Future — Differentiated/Niche |
| 12 | External integrations (job boards, email provider, e-signature, calendar sync, HRIS, SMS, VMS) | Mixed M/P2/Future per integration |

## Known limitations

- **`positionsFilledCount` does not yet auto-update.** The column exists and defaults to `0` as
  the PRD requires, but no code writes to it — not even Module 4's `createApplication`, since an
  *application* existing doesn't mean a position is *filled*. That requires the future Offer
  module (§11.6), which is what actually fills a position.
- **No aging-indicator UI.** `createdAt` is stored and available, but the job list/detail UI
  does not yet render a derived "age" affordance.
- **The role-permission matrix UI does not yet reflect per-resource applicable actions.**
  `src/lib/authz/resource-actions.ts#getApplicableActions` was written in Module 2 so the
  matrix could grey out, e.g., `APPROVE` for resources where it doesn't apply — it is not yet
  consumed by the matrix component, which still renders the four Module 1 CRUD columns
  unconditionally for every resource, including `JOB`.
- **`FieldPermission` is not yet exercised by the Job module.** The field-level visibility
  engine from Module 1 works, but no Job field is currently field-permission-gated; this only
  becomes relevant once a Job field is sensitive enough to warrant it (e.g. a future
  compensation field on Candidate/Offer).
- **A discrepancy between malformed and well-formed unauthorized requests.** An unauthenticated
  or under-permissioned `POST`/`PATCH`/`PUT` with an empty or malformed body returns `400`
  (Zod validation runs before the service's permission check) rather than `403`; a
  well-formed-but-unauthorized payload correctly returns `403`. Investigated in Phase 5 and
  left as-is: it leaks no sensitive information and does not affect functionality, per the
  Phase 5 instruction not to change behavior absent a real bug.
- **No hard delete for jobs**, by design (Phase 1 decision) — a job unwanted in Draft or later
  is cancelled via the status endpoint, not removed from the database.
- **Local filesystem storage is not production-durable.** The only `StorageProvider`
  implementation is `LocalStorageProvider`, explicitly documented as development-only — it
  writes to disk on whichever instance handles the request, with no replication, backup, or
  multi-instance consistency. A production deployment needs a new `StorageProvider`
  implementation (e.g. S3) before candidate documents can be trusted to survive a redeploy or
  scale-out.
- **No GDPR retention/soft-delete workflow beyond hard delete.** `DELETE /api/candidates/[id]`
  permanently removes the record and its files; there is no "right to be forgotten" request
  queue, retention-period policy, or anonymize-instead-of-delete option. §13's consent capture
  is implemented; broader retention/erasure workflow tooling is not.
- **Resume auto-parsing is deferred.** Uploading a resume stores the file; nothing extracts
  structured fields (name, experience, skills) from it. This is intentionally scoped to the
  PRD's AI & Automation Assistant (§11.11), sequenced after core parity per §14's roadmap.
- **No column-mapping UI for bulk import.** The import preview expects a fixed set of
  case-insensitive column names (see [api.md](api.md#post-apicandidatesimportpreview)); a
  source file with differently-named columns must be relabeled before upload rather than
  mapped in the UI.
- **Consent is a single timestamp, not granular by consent type.** `consentGivenAt` records
  that consent was given at creation time; it does not distinguish between, e.g., consent to
  store data versus consent to be contacted, and there is no mechanism to update or revoke it
  independent of the rest of the record.
- **Bulk email is queued-only infrastructure, not real delivery.** `POST
  /api/applications/bulk/email` renders a template and writes an `ApplicationEmailLog` row per
  recipient with `status: PENDING` — it never calls a mail provider, and nothing in this module
  ever transitions a log row to `SENT`/`FAILED`. This is intentional (Phase 2 decision): real
  email delivery is scoped to the PRD's Communication Hub module (§11.10), a later module.
- **No Workflow & Automation Builder yet (§10.2).** Both Job's approval flow (Module 2) and
  Application's pipeline stages (Module 4) are configurable *data* (a status-transition table,
  a per-job ordered stage list) but not a visual, no-code, admin-authored workflow — that's the
  PRD's separate Workflow & Automation Builder module, not yet started. Application stage
  transitions are also **unrestricted** (any stage to any stage) rather than gated by a
  configurable rule set, a deliberate Phase 2 scope decision for this module, not an oversight.
- **No Reporting & Analytics module yet (§11.12).** There is no dashboard, report builder, or
  pipeline-conversion/funnel reporting surface anywhere in the app; the audit log and the
  Applications list/board are the only ways to inspect pipeline activity today.
- **No Interview Management module yet (§11.5).** Applications can reach an `Interview` pipeline
  stage (one of the four default stage names), but nothing schedules interviews, collects
  structured interviewer feedback, or links a scheduled event to an `Application` — reaching that
  stage is just a label until the Interview module exists.
- **Deactivating a `PipelineStage` doesn't check for active applications at the service layer.**
  `PUT /api/jobs/[id]/pipeline-stages` will happily deactivate a stage that still has `ACTIVE`
  applications sitting in it — their `stageId` is left pointing at the now-inactive stage
  undisturbed (by design; a stage is data, applications aren't force-migrated off it), but
  nothing blocks the deactivation itself. The pipeline-stage editor UI blocks this client-side
  (showing the caller how many active applications are still in the stage), but that's a
  courtesy, not enforcement — an API caller can bypass it.
- **The per-job Pipeline page loads at most 100 applications.** The `/jobs/[id]/pipeline` server
  component calls `listApplications` with a fixed `pageSize: 100` for the board/list view; a job
  with more than 100 applications will not show the rest on that page (the global `/applications`
  list, which paginates properly, is unaffected). Not encountered in practice at this scale, but
  worth fixing before a very high-volume job's pipeline is used as the primary view for it.

## Future roadmap (from the PRD, §14)

- **V1 — Core Parity**: match the three reference products' core ATS capability — the
  remaining modules table above, plus the full Customization Engine (§10, largely delivered in
  Module 1).
- **P2 — Extended Capability**: valuable but not launch-blocking — resume parsing, the
  client/staffing portal, an SMS channel, offer-letter generation, and calendar sync.
- **Future — Differentiated/Niche**: relevant only under specific business models — AI
  matching/Voice AI, VMS/contingent-workforce tooling, credentialing/license tracking, and
  timesheet/invoicing integration.

The PRD (§11.11) deliberately sequences AI capability after core parity and the customization
engine are proven, to avoid building novelty features on an unstable foundation — this build
order follows that sequencing.
