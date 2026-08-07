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

### Module 5 — Interview Management (PRD §11.5)

All `M`-priority requirements from §11.5 are implemented:

- Schedule an interview against an Application — round name, mode (onsite/virtual/phone),
  location/link, date/time, duration, and one or more assigned panelists. ✅
- Reschedule/edit details, cancel with a required Controlled List reason, and mark complete. ✅
- Structured feedback per interviewer (recommendation, 1–5 rating, comments), one editable
  scorecard per interviewer per interview — no separate "submitted" lock. ✅
- Two independent access paths: whoever scheduled it (OWN/TEAM scope, like Job/Application), and
  each assigned panelist (their own interviews, to read and file feedback). ✅
- The candidate timeline (Modules 3–4) gains `interview_scheduled`/`interview_completed`/
  `interview_cancelled`/`interview_feedback_submitted` item types via the same extensible
  contract. ✅
- Custom fields on Interviews via the existing Customization Engine. ✅
- Interview does not itself decide the pipeline outcome — advancing/rejecting a candidate based
  on feedback still goes through Application's existing transition endpoint (Module 4), by
  design (§8: Interview schedules and records, it doesn't decide). ✅ (scoped)

### Module 6 — Offer Management (PRD §11.6)

All `M`-priority requirements from §11.6 are implemented:

- Draft an offer against an Application (compensation, expected joining date, notes); at most
  one non-terminal offer per application, enforced by a partial unique index, not just a
  service-layer check. ✅
- A fixed table-driven status machine — `DRAFT → PENDING_APPROVAL → APPROVED → EXTENDED →
  ACCEPTED/DECLINED`, plus `REVOKE` from any non-terminal status — mirroring Job's own approval
  workflow shape. ✅
- Approval step with its own append-only `OfferApproval` history (one row per submit/resubmit
  cycle), decided by whoever holds `OFFER:APPROVE` (Hiring Manager, ALL scope), independent of
  who drafted the offer. ✅
- Decline/Revoke require a Controlled List reason (`OFFER_OUTCOME_REASON`). ✅
- Accepting an offer increments the parent Job's `positionsFilledCount` — the first module to
  actually drive that counter (see Module 2's note above and
  [Known limitations](#known-limitations)). ✅
- "HR / Onboarding" (seeded in Module 1, unused until this module) gets its first real grant:
  read-only visibility into offers. ✅
- The candidate timeline gains `offer_created`/`offer_approved`/`offer_approval_rejected`/
  `offer_extended`/`offer_accepted`/`offer_declined`/`offer_revoked` item types. ✅
- Custom fields on Offers via the existing Customization Engine. ✅

### Module 7 — Onboarding Handoff / HRIS Integration (PRD §11.7)

All `M`-priority requirements from §11.7 are implemented:

- An Offer reaching `ACCEPTED` (Module 6) automatically creates a `HandoffRecord` — no separate
  create endpoint; a handoff only ever exists as a side effect of an accepted offer. ✅
- The handoff package is a frozen snapshot taken at creation — candidate profile, final offer
  terms, and the candidate's full document manifest — captured once and never re-read live, the
  same "render once, store the result" choice as `ApplicationEmailLog`. ✅
- An `HrisProvider` abstraction (`src/lib/hris/`) behind which delivery happens; today only a
  `StructuredExportProvider` is implemented (§12: real HRIS API integrations are out of scope
  for v1) — mirrors `StorageProvider`'s "interface + one real implementation + env-driven
  factory" shape exactly. `API_PUSH` is a recognized `HandoffDeliveryMethod` value reserved for
  a future real connector, never written today. ✅ (scoped)
- Delivery is attempted immediately on creation and logged as an append-only
  `HandoffDeliveryAttempt` row; a failed attempt lands the handoff in `EXCEPTION` with the
  failure reason, and it can be retried — retry re-pushes the *original frozen payload*, it does
  not re-snapshot the candidate. ✅
- HR/Onboarding acknowledges a delivered package as `ACCEPTED` or reports an `EXCEPTION` with a
  reason — reusing the existing global `APPROVE` permission action rather than adding a new one,
  the same "gatekeeper decision" semantics Job/Offer's `APPROVE` already models. ✅
- Once acknowledged `ACCEPTED`, the linked Application becomes read-only: it can no longer be
  rejected/withdrawn/re-staged, and can't collect a new interview or offer — enforced by one
  shared helper (`assertApplicationNotHandedOff`) called from all three affected services, not a
  new field on Application itself. ✅
- The candidate timeline gains `handoff_initiated`/`handoff_delivered`/`handoff_accepted`/
  `handoff_exception` item types. ✅
- Custom fields on Handoffs via the existing Customization Engine. ✅

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

## Completed phases (Module 7)

1. **Investigation** — read the Offer module end-to-end (schema, status machine, service,
   routes, seed) as the closest precedent, plus the candidate timeline, audit system, entity
   registry, `StorageProvider` (the abstraction `HrisProvider` is modeled on), and the existing
   `outcome !== "ACTIVE"` guards in `applications.ts`/`interviews.ts`/`offers.ts` that
   `assertApplicationNotHandedOff` extends.
2. **Technical Design** — `HandoffRecord`/`HandoffDeliveryAttempt` schema and migration; an
   `HrisProvider` interface with one `StructuredExportProvider` implementation and an
   env-driven factory (`src/lib/hris/`); acknowledgement reusing the global `APPROVE`
   permission action rather than a new one; no table-driven state machine (Handoff's shape is
   closer to Interview's independent actions than Job/Offer's sequential workflow); read-only
   archive behavior sourced from `HandoffRecord.status` alone, no new `Application` field.
3. **Backend Implementation** — schema and migration, validations (`handoff.ts`),
   `HandoffService` (`buildHandoffPayload`, `createHandoffForOffer`,
   `assertApplicationNotHandedOff`, `getHandoff`/`listHandoffs`/`retryHandoff`/
   `acknowledgeHandoff`), thin API routes, registry/seed updates (Handoff role permissions —
   Recruiter/Recruiting Manager get retry authority over their own initiated handoffs,
   HR/Onboarding gets read + acknowledge), and cross-module wiring (`transitionOffer`'s ACCEPT
   branch triggers the handoff; `transitionApplication`, `scheduleInterview`, and `createOffer`
   each call the new read-only guard).
4. **Frontend Implementation** — an Onboarding Handoff card on the Application detail page
   (status, delivery-attempt history, retry and confirm-receipt/report-exception actions, all
   permission-gated) and an archive banner + hidden create-affordances once a handoff is
   `ACCEPTED`; candidate-timeline item types for the four handoff milestones.
5. **Testing** — 34 new automated tests (service layer: creation via both the successful and
   the deterministic-failure delivery path, access control, retry/acknowledge state gating,
   optimistic-locking conflicts, two concurrency tests, cascade-delete, cross-module read-only
   enforcement, candidate-timeline integration; validation-schema edge cases), plus a targeted
   fix to an existing Module 6 test whose cleanup predates Module 7's new `HandoffRecord` foreign
   key. Full regression suite: 338 tests passing project-wide.
6. **Browser verification** — a real Chromium walkthrough of both paths: candidate-with-email
   (offer accept → `DELIVERED` handoff → confirm receipt → `ACCEPTED` → archive banner → offer
   creation blocked → all four timeline items rendered) and candidate-without-email (offer
   accept → `EXCEPTION` handoff with the delivery-failure reason shown → retry re-attempts the
   frozen payload and correctly stays `EXCEPTION`).
7. **Self code review** — found and fixed one genuine gap: `HandoffRecord` was missing an index
   on `initiatedById` (the column `listHandoffs`' OWN/TEAM scope filters on), unlike
   `Offer.createdById`'s equivalent index — added via its own migration, plus one additional
   concurrency test (concurrent `acknowledgeHandoff` calls) for parity with the existing
   concurrent-retry coverage.

## Remaining modules

Per the PRD's §11 module breakdown and §14 roadmap, not yet started:

| PRD § | Module | Roadmap phase |
| --- | --- | --- |
| 11.3 | Sourcing & Job Board Distribution | V1 — Core Parity |
| 11.10 | Communication Hub (email logging, template-driven messaging) | V1 — Core Parity |
| 11.12 | Reporting & Analytics, incl. custom dashboard/report builder (§10.5) | V1 — Core Parity |
| 10.2 | Workflow & Automation Builder (visual, no-code, per-job/pipeline) | *implicit, underlies later V1 modules' configurability* |
| 10.4 | Template Designer (email templates, offer letters, e-signature-ready) | *implicit* |
| 11.8 | Client / Staffing Portal *(optional module)* | P2 — Extended Capability |
| 11.9 | Contingent Workforce & Compliance Tools *(optional module)* | Deferred until a business need is confirmed / Future |
| 11.11 | AI & Automation Assistant (resume parsing, match scoring, summaries, JD drafting, Voice AI) | Future — Differentiated/Niche |
| 12 | External integrations (job boards, email provider, e-signature, calendar sync, HRIS, SMS, VMS) | Mixed M/P2/Future per integration |

## Known limitations

- **`positionsFilledCount` now auto-updates, as of Module 6.** The column existed from Module 2
  onward, defaulted to `0`; Module 6's `transitionOffer` increments it by one on every `ACCEPT`
  transition (the offer, not the application, is what actually fills a position). No aging-
  indicator UI still exists (see below).
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
- **The `HrisProvider` abstraction has exactly one implementation.** `src/lib/hris/` mirrors
  `StorageProvider`'s shape (interface + one real implementation + env-driven factory,
  `HRIS_PROVIDER` defaulting to `"structured_export"`), but no real HRIS API connector exists
  yet — `HandoffDeliveryMethod.API_PUSH` is a recognized value nothing ever writes. Same
  intentional "infrastructure exists, only a later integration effort writes the other value"
  pattern as `EmailLogStatus`/`positionsFilledCount` before Module 6.
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
