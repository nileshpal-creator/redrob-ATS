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
  organization-level working days/hours — unconsumed by any service until Module 9's
  business-day TAT arithmetic (`src/lib/reporting/business-days.ts`).

### Module 2 — Requisition / Job Management (PRD §11.1)

All `M`-priority requirements from §11.1 are implemented:

- Create a job with title, department, employment type, positions count, location, target
  date, priority. ✅
- Configurable-workflow-shaped approval flow before a job opens for sourcing (draft → pending
  approval → open) — built as a **simple, fixed** state machine per Phase 1's explicit scope
  decision, not rewired onto the PRD's separate Workflow & Automation Builder (§10.2, Module 10)
  once that shipped — Module 10's builder reacts to Application-level events, not Job's own
  status transitions. ✅ (scoped)
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
- Bulk email — originally **infrastructure only** (renders a template, logs what would be sent,
  status always `PENDING`); Module 8 (Communication Hub, §11.10) completed real delivery. ✅
  (completed by Module 8, see its own section below)
- Interview scheduling, feedback capture, and offer generation were explicitly out of scope for
  *this* module — they belong to the PRD's Interview Management (§11.5) and Offer Management
  (§11.6) modules, both completed since (see their own sections below).

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
- Automatic email reminders to candidate and panel at configurable intervals. ✅ *(as of
  Module 12)* — was left unimplemented at the time this module first shipped (no
  scheduler/cron mechanism existed yet in this codebase); see Module 12 below for the reminder
  model, retry/backoff logic, and the external-scheduler-invoked endpoint that actually sends
  them.

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

### Module 8 — Communication Hub (PRD §11.10)

The two `M`-priority requirements from §11.10 are implemented; the two P2/Future rows (SMS, AI
chat) are correctly deferred:

- Email is the primary channel, fully logged against candidate records — `bulkEmailApplications`
  (Module 4) now actually sends (via a new `MailProvider` abstraction) instead of only queuing,
  and every `ApplicationEmailLog` row lands as `SENT` or `FAILED` rather than a permanent
  `PENDING`. ✅
- Template-driven, variable-substituted messaging — a new admin-managed `CommunicationTemplate`
  model (name, subject, body with `{{key}}` placeholders via the existing `renderTemplate()`
  helper) replaces the free-typed subject/body the bulk-email dialog previously had. This is
  deliberately the *minimal* slice of the full Template Designer (§10.4) that this
  M-requirement needs — not multi-language variants, conditional blocks, version history, or an
  approval workflow, which stay their own future module. ✅ (scoped)
- `src/lib/mail/` mirrors `StorageProvider`/`HrisProvider`'s "interface + one real
  implementation + env-driven factory" shape exactly — only a `ConsoleMailProvider` exists; a
  real Gmail/Outlook API connector (§12) needs OAuth credentials out of scope for this pass. ✅
  (scoped)
- SMS channel — correctly not built (§11.10 tags it P2). ⏸ deferred
- AI chat / conversational engagement — correctly not built (§11.10 tags it Future). ⏸ deferred
- The candidate timeline gains `email_sent`/`email_failed` item types — completing §11.2's own
  "every application, interview, offer, note and email in one view" requirement, which had
  shipped everything except the email part until now. ✅

### Module 9 — Reporting & Analytics (PRD §11.12)

Six of the seven requirements from §11.12 are implemented; the seventh (the full custom
dashboard/report builder, §10.5) is deliberately scoped down, the same way Module 8 scoped down
the Template Designer:

- Pipeline funnel and conversion reporting by stage, job, recruiter and source. ✅
- Time-to-fill and time-to-offer reporting, in business days. ✅
- Recruiter productivity and workload reporting. ✅
- Offer/TAT compliance reporting — measured `Offer.createdAt` → the approved
  `OfferApproval.decidedAt`, the one leg of Offer's lifecycle with its own immutable timestamp;
  the compliance threshold is a report parameter, not an invented stored org policy. ✅
- Custom dashboard and report builder (§10.5) — **scoped down, not the full requirement.**
  `SavedReport` lets a viewer name, save, and (for scheduled ones) share one of the four
  pre-built reports above with its filters. There is no drag-and-drop widget layout, no
  arbitrary-entity query, and no custom-field aggregation — building that full engine is a
  separate, much larger effort. Row-level security (§10.5's own third bullet) *is* fully
  implemented: running a saved report always re-applies the runner's own permission scope, never
  a row-set fixed at save time. ⚠️ partial, see [Known limitations](#known-limitations)
- Scheduled report delivery by email. ✅ (scoped) — the business logic
  (`runDueScheduledReports`) is real and fully tested; no cron/queue infrastructure exists
  anywhere in this app to actually invoke it periodically, the same environment limit every
  provider abstraction in this codebase already documents. `POST /api/saved-reports/run-due`
  exists for an external scheduler to call.
- Export to Excel/CSV and PDF. ✅ — XLSX/CSV reuse `candidate-export.ts`'s exact pattern; PDF is
  new (`pdf-lib`, this module's one new dependency) and renders a plain text table, not a
  fully laid-out grid.

### Module 10 — Workflow & Automation Builder (PRD §10.2)

All five requirements from §10.2 are implemented:

- A no-code rule builder: "when [event] and [condition], then [action]". ✅ — `/admin/workflows`,
  a form-based builder (trigger picker + type-specific config, an AND-only condition list, one
  or more actions), not a drag-and-drop canvas. AND-only matches §10.2's own literal phrasing;
  there is no OR/grouping.
- Supported triggers: stage change, field update, time elapsed in a stage, form submission. ✅
  — `STAGE_CHANGE`/`FIELD_UPDATE`/`TIME_IN_STAGE`/`FORM_SUBMISSION`, all four implemented and
  wired into their real triggering call sites in `applications.ts`.
- Supported actions: send templated email/notification, create a task, change a field, reassign
  an owner, request approval. ✅ (scoped) — `SEND_EMAIL` (this codebase's one real notification
  channel, per Module 8; there is no separate in-app notification action),
  `CREATE_TASK`/`CHANGE_FIELD`/`REASSIGN_OWNER`/`REQUEST_APPROVAL`, all five implemented.
  `CHANGE_FIELD` is scoped to `Application.customFields` only — core lifecycle fields
  (stage/outcome/owner) keep their own guarded state-machine/transition paths, which a generic
  field-setter would otherwise bypass.
- Per-job and per-pipeline configuration, not forced to apply globally. ✅ — `jobId` is nullable
  on `WorkflowDefinition` (`null` = every job); `STAGE_CHANGE`/`TIME_IN_STAGE` triggers require a
  non-null `jobId` since the `PipelineStage` they reference is itself job-scoped.
- Full version history, with the ability to roll back. ✅ — every trigger/conditions/actions
  save creates a new `WorkflowDefinitionVersion` row and re-points `activeVersionId`; rollback
  re-points it at an older, still-existing version. History is never mutated or deleted.

### Module 11 — Sourcing & Job Board Distribution (PRD §11.3)

All five requirements from §11.3 are implemented:

- Post a job to major job boards from a requisition. ✅ (scoped) — `JobPosting`, one row per
  (job, board), created via a `JobBoardProvider` abstraction (`src/lib/job-boards/`) rather than
  a hard-coded single vendor. Only a `MockJobBoardProvider` exists — no real board API
  credentials are available in this environment (§12); see Known limitations.
- Source attribution per candidate. ✅ — reuses `Candidate.sourceId` (the existing
  `CANDIDATE_SOURCE` controlled list), set once at creation and never overwritten by a later
  event, per §9's "held once globally" rule. No new source concept was introduced.
- Inbound applications automatically enter the appropriate pipeline. ✅ — `receiveInboundApplication`
  calls the same `createApplication` every other application-creation path uses, which drops a
  new application into the job's first active pipeline stage exactly as before.
- Inbound applications are automatically tagged with their source. ✅ — the candidate is created
  (or, on a phone match, reused) with `sourceId` set to the posting's own board, and the new
  `Application.sourcedFromPostingId` records which specific posting drove this particular
  application — a second, more granular signal alongside `Candidate.sourceId`.
- Referral capture as a distinct source type. ✅ — a dedicated "Refer a candidate" flow
  (`createReferral`) creates the candidate and application together with source fixed to the
  `CANDIDATE_SOURCE` list's existing "Referral" value.

There is no public, unauthenticated career-site/apply page in this codebase (§7's explicit scope
boundary) — inbound applications are recorded by staff who already have a session, not received
via an unauthenticated webhook from a real board.

### Module 12 — Scheduler Infrastructure (§11.5 reminders / §11.12 scheduled reports / §10.2 TIME_IN_STAGE)

Not its own PRD section — infrastructure the PRD's own M-tagged requirements need
(§11.5's "automatic email reminders... at configurable intervals," §11.12's "scheduled report
delivery by email," §10.2's "time elapsed in a stage" trigger) but that this codebase had no
mechanism for until now (no cron/queue/worker process existed anywhere in the app):

- Interview reminders (§11.5) are implemented from scratch — see Module 5's section above,
  updated to mark this requirement done.
- Scheduled report delivery (§11.12, Module 9) is unchanged in shape, with one real idempotency
  gap fixed: the original `lastRunAt`-based check-then-act could double-send under overlapping
  scheduler ticks (found via an adversarial self-review, not by the initial implementation).
- TIME_IN_STAGE workflow triggers (§10.2, Module 10) are completely unchanged — the engine
  already had correct idempotency; only a batch-size bound was added to its due-application
  query.
- **No cron/queue infrastructure exists inside this app, still** — `POST /api/scheduler/run` is a
  secure, idempotent, bounded execution endpoint; genuine periodic invocation remains external
  infrastructure's job (Vercel Cron, AWS EventBridge, a Railway/Render cron job, a Kubernetes
  CronJob, Windows Task Scheduler, or a plain OS crontab).

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

## Completed phases (Module 8)

1. **Investigation** — the PRD text itself isn't committed to this repo; read §11.10's exact
   requirements from the source PDF, plus §10.4 (Template Designer) and §14's roadmap (which
   places §10.4 in the same V1 phase as §11.10). Read Module 4's existing `ApplicationEmailLog`/
   `bulkEmailApplications` stub, `src/lib/templates/render.ts`, the `StorageProvider`/
   `HrisProvider` abstraction pattern, and confirmed the candidate timeline had never gained an
   email item type despite §11.2 already committing to one.
2. **Technical Design** — a `CommunicationTemplate` model scoped to exactly what §11.10's own
   M-requirement needs (not the full §10.4 designer); a `MailProvider` abstraction mirroring
   `StorageProvider`/`HrisProvider`; `bulkEmailApplications` rewritten to resolve a template
   once upfront and actually send; admin-metadata RBAC tier (open read, `requirePermission`
   mutations, no seeded grant, relying on the existing `isSuperAdmin` bypass) rather than the
   owned-record tier Job/Offer/Handoff use.
3. **Backend Implementation** — schema and migration, validations
   (`communication-template.ts`, and the rewritten `applicationBulkEmailSchema`), `src/lib/mail/`,
   `CommunicationTemplateService`, thin API routes, registry/audit-action updates, and the
   `bulkEmailApplications` rewrite.
4. **Frontend Implementation** — `/admin/communication-templates` (create/edit/deactivate,
   `DataTable` + dialogs mirroring the Custom Fields admin page) with a new nav entry, and the
   Applications list's bulk-email dialog rewritten from free-typed subject/body to a template
   picker.
5. **Candidate timeline integration** — `email_sent`/`email_failed` item types, closing the one
   gap left in §11.2's own candidate-timeline requirement.
6. **Testing** — validation-schema tests, `CommunicationTemplateService` tests (RBAC via the
   `isSuperAdmin` bypass, open read, duplicate-name rejection including a concurrency test,
   active/inactive filtering), and `bulkEmailApplications` tests (successful send, no-email skip,
   unknown/inactive template rejection, candidate-timeline integration). Full regression suite:
   362 tests passing project-wide.
7. **Browser verification** — a real Chromium walkthrough: create a template via the admin UI →
   pick it in the bulk-email dialog → send → confirmed `SENT` status, rendered
   subject/body, and the `ConsoleMailProvider` log line via direct database and server-log
   inspection → candidate timeline shows the `email_sent` item → deactivating the template in the
   admin UI correctly removes it from the send picker.
8. **Self code review** — found and fixed one genuine gap: `createCommunicationTemplate`'s
   duplicate-name pre-check had the same TOCTOU race `createOffer`'s own comment warns about —
   two concurrent creates could both pass the `findUnique` check and one would hit the database's
   unique constraint as an unhandled 500. Added the same `P2002 -> ValidationError` catch
   `createOffer` uses, plus a concurrency test for it. Also corrected several now-stale
   documentation claims across `README.md`, `CHANGELOG.md`, `docs/api.md`,
   `docs/architecture.md`, and `docs/database.md` that described `ApplicationEmailLog` as
   permanently `PENDING`/infrastructure-only — all direct fallout of this module's own changes,
   not pre-existing drift from other modules.

## Completed phases (Module 9)

1. **Investigation** — read §11.12's exact requirements and §10.5 (Custom Dashboards & Reports)
   from the source PDF. Checked for existing reporting/export/dashboard code (found
   `candidate-export.ts`'s CSV/XLSX pattern and its "reuse the entity's own `:READ`" precedent),
   any charting library (none), any cron/queue infrastructure (none), and
   `Organization.workingDays`/`Holiday` — present since Module 1, never consumed by any service.
2. **Technical Design** — four report functions each reusing the underlying entity's own
   permission/scope rather than a new `REPORT` resource; a `SavedReport` model scoped as the
   minimal faithful slice of §10.5 (pick one of the four report types + filters, not a generic
   builder); a business-day utility as the first real consumer of Module 1's working-day
   columns; TAT measured against `OfferApproval.decidedAt` rather than `Offer.updatedAt`, since
   the latter only reflects an offer's *latest* status flip and can't be trusted for offers that
   have since moved past `EXTENDED`.
3. **Backend Implementation** — schema (`SavedReport` + 4 enums) and migration, `entity-registry`/
   seed RBAC grants, `src/lib/reporting/business-days.ts`, the four report functions
   (`src/lib/services/reports.ts`), `SavedReport` CRUD (`saved-reports.ts`), export
   (`report-export.ts`, adding `pdf-lib`), the scheduled-delivery runner
   (`scheduled-reports.ts`), and thin API routes for all of the above.
4. **Frontend Implementation** — `/reports`: a tab per pre-built report (filters, run, results
   table, export buttons, "save as report") plus a Saved Reports tab (list, schedule editing,
   delete). Nav entry gated on `JOB:READ` or `OFFER:READ`.
5. **Testing** — `business-days.test.ts` (pure unit), `report.test.ts` (Zod schemas),
   `reports.service.test.ts` (all four reports against a deterministic fixture, plus RBAC
   scoping), `saved-reports.service.test.ts` (CRUD, optimistic locking, RBAC,
   schedule/recipient cross-field validation, a concurrency test), `scheduled-reports.service.
   test.ts` (due-detection for DAILY/WEEKLY, deactivated-creator handling), and
   `report-export.service.test.ts` (real parseable XLSX/CSV/PDF output). Full regression suite:
   422 tests passing project-wide.
6. **Browser verification** — a real Chromium walkthrough via Playwright: logged in, ran the
   Pipeline Funnel report against a real job and confirmed the results table; saved it as a
   report, scheduled it (`DAILY`, a recipient email), confirmed the schedule persisted across a
   page reload, then deleted it; ran Recruiter Productivity and Offer TAT Compliance with no
   required filters. Separately verified via the browser's authenticated request context that
   `GET /api/reports/export` returns real, non-empty XLSX/CSV/PDF files with correct
   content-types, and that `POST /api/saved-reports/run-due` actually delivers a scheduled
   report — confirmed by inspecting the dev server's `ConsoleMailProvider` log line, which showed
   the real rendered CSV attachment (file name, content type, byte count matching the earlier
   ad-hoc export).
7. **Self code review** — found and fixed two genuine issues while writing
   `reports.service.test.ts`'s fixture: (1) `getPipelineFunnelReport`'s "reached stage N" count
   only consulted `ApplicationEvent.toStageId`, silently undercounting any application's
   *initial* stage once it moved past it (nothing "moves an application into" the stage it was
   created at, so that stage never appears as a `toStageId`) — fixed by also folding in
   `fromStageId`. (2) `getRecruiterProductivityReport` ran 5 `count()` queries *per recruiter* in
   a loop — an N+1 that scales with team size for TEAM/ALL-scope viewers — rewritten to 5 flat
   `groupBy` queries independent of recruiter count. Also split `getSessionContextForUser` out
   of `session-context.ts` into its own file: that file's `getSessionContext` imports
   NextAuth's `auth()`, an entirely unrelated dependency for what the scheduler needs (a plain
   user-id lookup), and pulling it in transitively broke importing the function under Vitest
   (NextAuth's ESM/CJS interop with `next/server` doesn't resolve outside the Next.js runtime) —
   discovered while writing `scheduled-reports.service.test.ts`.

## Completed phases (Module 10)

1. **Investigation** — re-read the PRD directly rather than from memory: §10.2 (Workflow &
   Automation Builder), §10.4 (Template Designer), and §11.3 (Sourcing) were all plausible
   candidates for "the next module" — §14's roadmap lists §10.2/§10.4 together under V1 Core
   Parity's "full Customization Engine" bucket but conspicuously omits §11.3 despite its own
   M-tags. Presented all three to the user; §10.2 was selected. Checked existing architecture
   for precedent: `PipelineStage`'s "deactivate, don't delete" convention, `Offer`/`SavedReport`'s
   business-record tier (OWN/TEAM/ALL + optimistic locking) vs `CommunicationTemplate`'s
   admin-metadata tier (open read, no version), `JobStatusChange`'s append-only history pattern,
   and confirmed (again) that no cron/queue infrastructure exists anywhere in this app.
2. **Technical Design** — `WorkflowDefinition`/`WorkflowDefinitionVersion` versioned the same
   way `Job`'s status history is; business-record tier, not admin-metadata, since an automation
   has real side-effect risk with no further per-action human review; a `WorkflowExecution`
   ledger with a unique `(version, applicationId, fingerprint)` constraint as the idempotency
   guard (the same "let the database be the guard" pattern `createOffer` already establishes),
   needed specifically because `TIME_IN_STAGE` has no single triggering write and gets
   re-evaluated on every scheduler call; `WorkflowTask`'s two-path access (application-manager or
   assignee, unconditionally) reasoned through explicitly as *not* identical to Interview's
   panelist path, since a `REQUEST_APPROVAL` recipient may hold no `APPLICATION:UPDATE` grant at
   all; `CHANGE_FIELD` scoped to `customFields` only, to avoid bypassing existing guarded
   lifecycle-field transitions; automations run after their triggering write commits, outside
   its transaction, since `SEND_EMAIL` is external I/O that must never roll back the user's own
   action.
3. **Backend Implementation** — schema (`WorkflowDefinition`/`WorkflowDefinitionVersion`/
   `WorkflowTask`/`WorkflowExecution` + 4 enums, two migrations — the second added mid-design
   once the idempotency-ledger need was recognized) and migrations; `entity-registry`/seed RBAC
   grants; Zod validations (`workflow.ts`, discriminated unions per trigger/action type); the
   evaluate/execute engine (`workflows.ts`); `WorkflowDefinition` CRUD + versioning + rollback
   (`workflow-definitions.ts`); `WorkflowTask` lifecycle (`workflow-tasks.ts`); thin API routes
   for all of the above, including `POST /api/workflows/run-due` for an external scheduler.
4. **Cross-module hooks** — `transitionApplication`/`updateApplication`/`createApplication` in
   `applications.ts` each call `evaluateApplicationWorkflows` after their own write commits,
   with a shared `fireWorkflowsInBackground` wrapper that catches and only logs any error so a
   misbehaving automation can never fail or roll back the triggering request.
5. **Candidate timeline integration** — `task_created`/`task_completed`/`task_approved`/
   `task_rejected` item types in `getCandidateTimeline`, plus the corresponding render types in
   both `candidate-timeline.tsx` and `candidate-detail-client.tsx`.
6. **Frontend Implementation** — `/admin/workflows` (list, create, edit-with-version-history-
   and-rollback), a form-based trigger/condition/action builder (plain `useState`, not
   `react-hook-form` — conditions/actions are dynamic, differently-shaped-per-type arrays with no
   `useFieldArray` precedent elsewhere in this codebase), a Tasks card on the Application detail
   page, and `/tasks` ("My Tasks"). Nav entries gated on real RBAC grants
   (`WORKFLOW_DEFINITION:READ`), not restricted to super-admin.
7. **Testing** — `workflow.test.ts` (Zod schemas, 21 tests), `workflow-definitions.service.test.ts`
   (CRUD/versioning/rollback/RBAC/optimistic-locking concurrency, 16 tests),
   `workflow-tasks.service.test.ts` (dual access path, status-guarded concurrency, decide
   outcomes, 10 tests), `workflows.service.test.ts` (all three event-driven trigger hooks, all 5
   condition operators, all 5 action types, the idempotency guard, partial-failure handling, 20
   tests). Full regression suite: 489 tests passing project-wide.
8. **Browser verification** — a real Chromium walkthrough via Playwright against the dev
   database: logged in, built a `STAGE_CHANGE → CREATE_TASK` workflow through the real
   `/admin/workflows/new` form end to end, confirmed it listed on `/admin/workflows`, then
   triggered it via a real application stage transition and confirmed (via direct database
   inspection, since the exact click sequence for the transition dialog needed a few iterations
   to get right in the test script) that `WorkflowExecution` recorded `SUCCESS` and a
   `WorkflowTask` was created. Separately confirmed the created task rendered on both the
   Application detail page's Tasks card and `/tasks`, and that clicking "Mark done" there
   correctly resolved it (`OPEN` → `DONE`, verified in the database). Test data cleaned up from
   the dev database afterward.
9. **Self code review** — found and fixed one architecturally real issue and one static-check
   issue before any test ran against it: (1) the `/admin/workflows/[id]` edit page cast the
   stored version's JSON `conditions`/`actions` straight into the builder form's editable-draft
   shape (`as never`), but the two shapes don't match (optional fields vs. always-present
   strings) — left as a cast, this would have both mis-rendered the edit form and made the
   "did anything actually change" check always report a false positive, spawning a needless new
   version on every save. Fixed with real normalizer functions used for both purposes. (2) two
   stale comments elsewhere in the codebase still said the Workflow Builder "is Module 8", a
   leftover from before Module 8 became the Communication Hub — corrected to Module 10.

## Completed phases (Module 11)

1. **Investigation** — re-read §11.3 and §7's scope table directly from the source PDF. Searched
   the repository for any existing sourcing/job-board/referral/inbound-application abstraction
   (none found) and inspected `Candidate.sourceId`/`CANDIDATE_SOURCE`, `Job`/`primaryRecruiterId`,
   `createApplication`'s pipeline-entry logic, `PipelineStage`'s `assertJobAccess` RBAC-reuse
   pattern, and the `StorageProvider`/`HrisProvider`/`MailProvider` provider-abstraction template.
   Three ambiguities were surfaced and resolved by the user before writing any code: inbound
   application transport (staff-recorded intake, not an unauthenticated webhook — this app has no
   public apply page per §7), referral capture UI (one new combined candidate+application dialog,
   not two separate existing forms), and whether `Application` needs its own posting-attribution
   field distinct from `Candidate.sourceId` (yes — added `sourcedFromPostingId`).
2. **Technical Design** — a `JobBoardProvider` interface (post/remove only — no inbound-fetch
   method, since real boards vary wildly in how they deliver inbound applications back) with an
   env-driven factory and a `MockJobBoardProvider`, the same shape as
   `StorageProvider`/`HrisProvider`/`MailProvider`; `JobPosting` as a persistent, status-toggled
   row per (job, board) rather than an append-only log, with `@@unique([jobId, sourceId])` as the
   real guard against a double-post race; `JobPosting` reuses `JOB:<action>` RBAC scoped to
   `primaryRecruiterId` rather than a new permission resource, the same reuse `PipelineStage`
   already establishes; `Application.sourcedFromPostingId` added as an internal-only third
   parameter to `createApplication` (not part of the public Zod-validated input) so the existing
   `POST /api/applications` route can't be made to claim an attribution it can't validate.
3. **Backend Implementation** — schema (`JobPosting` + `JobPostingStatus` enum,
   `Application.sourcedFromPostingId`) and migration; `src/lib/job-boards/` (interface, mock
   provider, factory); validations (`job-posting.ts`); `job-postings.ts`
   (`createJobPosting`/`removeJobPosting`/`listJobPostings`/`receiveInboundApplication`) and
   `referrals.ts` (`createReferral`); thin API routes; audit actions
   (`JOB_POSTING_CREATED`/`JOB_POSTING_REMOVED`/`JOB_POSTING_INBOUND_APPLICATION_RECEIVED`/
   `CANDIDATE_REFERRED`).
4. **Frontend Implementation** — a "Job board postings" card on the Job detail page (post to a
   board, see POSTED/REMOVED/FAILED status with the provider's own error message, remove a
   posting, record an inbound application against it), a "Refer a candidate" dialog, and a
   "Source" column/field surfaced on the Applications list and detail page (`candidate.source`
   plus, where present, `sourcedFromPosting`) — all permission-gated on the same `JOB:UPDATE`/
   `CANDIDATE:CREATE`/`APPLICATION:CREATE` grants their underlying services already enforce.
5. **Testing** — `job-postings.service.test.ts` (20 tests: CRUD, RBAC, the DRAFT/OPEN status
   guard, duplicate-posting rejection, re-post-after-removal reusing the same row, two concurrency
   tests against the `@@unique` constraint and the status-guarded `removeJobPosting` update,
   the mock provider's deterministic FAILED path, inbound-intake candidate reuse without
   overwriting an existing source, plus a re-post concurrency test added during self code review
   below), `referrals.service.test.ts` (5 tests: combined creation, existing-candidate reuse,
   RBAC, the "no active Referral source configured" edge case), and `job-posting.test.ts` (9
   validation-schema tests). Full regression suite: 524 tests passing project-wide — no existing
   test needed modification despite `createApplication`'s new opts parameter and
   `applicationListInclude`'s extended shape.
6. **Browser verification** — a real Chromium walkthrough via Playwright against the dev
   database: logged in, created and opened a job, posted it to a board (status POSTED, an
   externalPostingId from the mock provider), recorded an inbound application (candidate + application
   created, tagged with the board as source), captured a referral (candidate + application created,
   tagged "Referral"), removed the posting (status REMOVED), and confirmed both the Applications
   list's new Source column and the Application detail page's "Source: … (… posting)" line render
   correctly for both new applications, with zero console/page errors throughout. Found and fixed
   one real accessibility bug in the process (below). Test data cleaned up from the dev database
   afterward.
7. **Self code review** — two independent passes, each catching one genuine defect: (1) the
   Playwright pass surfaced `job-postings-card.tsx`'s and `refer-candidate-dialog.tsx`'s
   `<Label>` elements having no `htmlFor`/matching input `id`, unlike the codebase's established
   convention (e.g. `candidate-form.tsx`'s `htmlFor="candidate-name"`/`id="candidate-name"`
   pairs) — a real accessibility regression (screen readers and label-click-to-focus wouldn't
   associate the label with its field), caught because Playwright's `getByLabel` locator relies
   on the same association; fixed by adding `htmlFor`/`id` pairs to every field in both
   components. (2) an independent adversarial review agent found that `createJobPosting`'s
   reactivate-an-existing-row branch (re-posting after a `REMOVED`/`FAILED` posting) used a plain
   `update()` with no status precondition, unlike `removeJobPosting`'s status-guarded `updateMany`
   — two concurrent re-posts of the same board could silently clobber each other's
   `externalPostingId`/audit trail instead of the second one being rejected. Fixed by making that
   branch a status-guarded `updateMany` (`WHERE id AND status != 'POSTED'`), the same shape
   `removeJobPosting` already uses, plus a new concurrency test.

## Completed phases (Module 12)

1. **Investigation** — re-read §11.5/§11.12/§10.2 and §14's roadmap directly from the source PDF.
   Confirmed via repo-wide grep that zero reminder-related code existed anywhere. Read
   `runDueScheduledReports`/`runDueTimeInStageWorkflows` in full and found `runDueScheduledReports`
   had a genuine, previously-undocumented idempotency gap (check-then-act on `lastRunAt`);
   confirmed `runDueTimeInStageWorkflows`'s existing `WorkflowExecution`-based idempotency was
   already sound. Confirmed `Organization` is a single global-settings row (not a multi-tenant
   boundary — no `organizationId` exists anywhere else in the schema), correcting a multi-tenant
   framing in the initiating instructions that didn't match this codebase's actual architecture.
   Confirmed `withApiHandler` unconditionally requires a session, with no precedent anywhere in
   this app for a non-session-authenticated route — the scheduler endpoint is a deliberate,
   narrow first exception, not a general new capability.
2. **Technical Design** — evaluated three architectures (a lightweight coordinator, a persistent
   generic job-queue table, an external-trigger abstraction) and chose the coordinator: the three
   consumers' own due-detection differs enough that a shared table would only paraphrase what
   each already does well. `InterviewReminder` (new): one row per (interview occurrence, lead
   time, recipient), combining unique-constraint-create-then-catch (first attempt) with a
   status-guarded `updateMany` (retry/stale-claim recovery) — the same two idempotency idioms
   `WorkflowExecution`/`removeJobPosting` already establish, applied together for the first time.
   `Organization.interviewReminderLeadMinutes` reuses the app's one existing global-settings
   singleton rather than a new settings table. Scheduler auth: a shared secret
   (`SCHEDULER_SECRET`) compared via SHA-256-then-`timingSafeEqual`, since a bare
   `timingSafeEqual` throws (and thus leaks) on a length mismatch.
3. **Backend Implementation** — schema (`InterviewReminder` + 2 enums,
   `Organization.interviewReminderLeadMinutes`) and migration; `src/lib/mail/test-failure-provider.ts`
   (a real, factory-wired `MailProvider` implementation whose entire purpose is deterministically
   failing sends, so retry logic has something genuine to exercise — `ConsoleMailProvider` never
   fails); `src/lib/services/interview-reminders.ts`; `src/lib/scheduler/auth.ts` +
   `src/lib/scheduler/run.ts`; `POST /api/scheduler/run`; `src/lib/services/organization.ts` +
   `GET`/`PATCH /api/organization`; `/admin/interview-reminders` (a fixed preset checklist, not
   free-text minute entry); audit actions
   (`INTERVIEW_REMINDER_SENT`/`_FAILED`, `SCHEDULER_RUN`, `ORGANIZATION_SETTINGS_UPDATED`); two
   `CommunicationTemplate` rows seeded so reminders work out of the box.
4. **Existing-module integration** — `runDueScheduledReports`: added a `SavedReport.version`-based
   atomic claim before sending (fixing the idempotency gap found in Phase 1) plus a
   `MAX_REPORTS_PER_RUN` batch cap. `runDueTimeInStageWorkflows`: added a
   `MAX_APPLICATIONS_PER_DEFINITION_PER_RUN` batch cap only — the engine itself
   (`claimExecutionSlot`, `evaluateConditions`, `runActionsAndFinalize`) was not touched.
5. **Testing** — `interview-reminders.service.test.ts` (13 tests: no-due-work, candidate+panelist
   as separate rows, idempotent repeat, concurrent-invocation dedup, retry-then-succeeds,
   permanent-failure-after-max-attempts, missing-email handling, one recipient's failure not
   blocking a sibling's success, cancelled/completed interviews never send, a reschedule's new
   occurrence still sends its own reminder, UTC due-time boundary correctness, batch-limit
   cutoff), `scheduler-auth.test.ts` (11 tests), `scheduler-run.test.ts` (4 tests: all-consumers-run,
   one-consumer-failure-isolation, all-three-fail, per-consumer duration reporting),
   `scheduler-run.test.ts` under `tests/api/` (6 tests: missing/wrong/non-Bearer auth all `401`,
   valid secret `200` with per-consumer shape, a `SCHEDULER` audit entry with `actorId: null`, the
   secret never appears in any response body), plus 2 new regression tests added to
   `scheduled-reports.service.test.ts` (concurrent-invocation dedup, batch-limit cutoff) and a
   third added during self-review (below). Full regression suite: 561 passing project-wide.
6. **Browser verification** — a real Chromium walkthrough via Playwright against the dev
   database: logged in, visited the new `/admin/interview-reminders` settings page and toggled a
   lead time, created a job/candidate/application/interview via the real APIs with the interview
   scheduled inside a configured lead window, called `POST /api/scheduler/run` with the wrong
   secret (`401`), then with the real secret (`200`, `interview-reminders` reported `sent: 2` —
   candidate + panelist), then called it again immediately (`sent: 0`, `skipped: 2` — proving no
   duplicate send). Investigated one transient console hydration warning observed during the
   first pass; could not reproduce it across three clean follow-up runs (a single fresh load, a
   single direct click, and all seven checkbox labels clicked individually), and the exact same
   `<label><Checkbox/></label>` pattern already exists unmodified elsewhere in this codebase
   (`recruiter-picker.tsx`) — concluded it was a one-off artifact of the verification script
   itself, not a real regression. Test data (job/candidate/application/interview/reminders) and
   the toggled setting were cleaned up from the dev database afterward.
7. **Self code review** — an independent adversarial review agent found two real issues beyond
   what the initial implementation and its own tests caught: (1) the *first* fix attempt for
   `runDueScheduledReports`'s idempotency gap (a `version`-only claim) closed the race between two
   callers reading the *identical* stale version simultaneously, but not a *subtler* one — a
   second scheduler tick starting **after** the first tick's claim but **before** its send
   finished would see the already-incremented version (not stale to it) and the still-old
   `lastRunAt` (still "due" to it), and would send the report again. Fixed by stamping
   `lastRunAt: now` as part of the *same* atomic claim that increments `version`, not after the
   send — closing the gap for the send's entire duration, not just the instant of the claim; a
   new regression test reproduces the exact scenario. (2) `sendOneReminder` looked up its
   `CommunicationTemplate` via `findFirst` once per recipient — up to `MAX_REMINDERS_PER_RUN`
   (500) separate queries per scheduler tick for only two distinct template names. Fixed by
   resolving both templates once per `runDueInterviewReminders` call into a small `Map`, threaded
   through instead of re-queried. A third, minor finding (never-run reports could starve behind
   an already-run backlog under Postgres's default `NULLS LAST` ordering once due reports exceed
   the batch cap) was fixed with `orderBy: { lastRunAt: { sort: "asc", nulls: "first" } }`.

## Remaining modules

Per the PRD's §11 module breakdown and §14 roadmap, not yet started:

| PRD § | Module | Roadmap phase |
| --- | --- | --- |
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
- **The `MailProvider` abstraction has exactly one implementation.** `src/lib/mail/` mirrors
  `StorageProvider`/`HrisProvider`'s shape (interface + one real implementation + env-driven
  factory, `MAIL_PROVIDER` defaulting to `"console"`), but no real Gmail/Outlook API connector
  exists yet (§12) — that needs OAuth credentials outside this environment's scope. Same
  intentional "infrastructure exists, only a later integration effort writes the other value"
  pattern as `HandoffDeliveryMethod.API_PUSH`.
- **Interview Management's "automatic email reminders" requirement (§11.5, M) is now
  implemented (Module 12).** `InterviewReminder` + `runDueInterviewReminders`, invoked via
  `POST /api/scheduler/run`. See Module 12's own Known limitations bullets below for what's
  still not covered (real cron invocation, exactly-once delivery).
- **Application stage transitions remain unrestricted (any stage to any stage), a Module 4
  scope decision Module 10 did not revisit.** The Workflow & Automation Builder (§10.2, Module
  10) *reacts* to a stage change via its `STAGE_CHANGE` trigger; it does not *gate* which
  transitions are legal — that stays Application's own state machine, unchanged.
- **`WorkflowTask` doesn't distinguish a plain to-do from an approval request at the schema
  level.** Both `CREATE_TASK` and `REQUEST_APPROVAL` produce the same row shape; the UI offers
  "Mark done" and "Approve"/"Reject" on every open task and lets whoever resolves it pick the
  one that matches what the task's title/description actually asks for, rather than the schema
  enforcing it.
- **No separate in-app notification action for workflows (§10.2's "send templated email/
  notification").** `SEND_EMAIL` is the only send action — this codebase's one real
  notification channel (Module 8) — the same scope this app's own Communication Hub already
  has; there is no in-app/push notification system to route a second action type to.
- **`TIME_IN_STAGE`'s external-scheduler need is now served by Module 12's
  `POST /api/scheduler/run`**, alongside scheduled reports and interview reminders. The
  underlying gap this bullet used to describe — nothing inside this app invokes anything
  periodically — is unchanged and still real; see Module 12's own Known limitations bullets
  below.
- **No generic drag-and-drop dashboard/report builder (§10.5's first bullet).** Module 9 built
  the four pre-built §11.12 reports plus a `SavedReport` that picks one of them with filters —
  not an arbitrary-entity, arbitrary-custom-field query/widget-layout engine. That full builder
  is a separate, substantially larger effort than any of the four M-priority report types
  themselves.
- **No cron/queue infrastructure exists *inside* this app, even after Module 12.** `POST
  /api/scheduler/run` (Module 12) is a real, secure, idempotent, bounded execution endpoint for
  all three scheduler-driven capabilities — but nothing in this Next.js process invokes it
  periodically on its own; no `setInterval`/`setTimeout` process exists, deliberately, since that
  would not be real production scheduling. External infrastructure (Vercel Cron, AWS
  EventBridge, a Railway/Render cron job, a Kubernetes CronJob, Windows Task Scheduler, or a
  plain OS crontab) must call it — see [docs/api.md](api.md#post-apischedulerrun) for exact setup.
- **Scheduled delivery (reports and interview reminders alike) is at-least-once, not
  exactly-once.** If the process crashes after a mail send is confirmed but before the
  finalizing database write commits, a later scheduler tick can legitimately reclaim and resend.
  Genuine exactly-once delivery to an external system needs a transactional outbox or
  provider-side idempotency keys — a materially larger undertaking than this module's scope,
  and out of proportion to `ConsoleMailProvider` being this environment's only real send path
  today.
- **The `JobBoardProvider`-style "one implementation, real credentials pending" pattern applies
  to the scheduler's own auth too, in spirit** — `SCHEDULER_SECRET` is a real, working
  shared-secret mechanism (not a stub), but no specific external scheduler (Vercel Cron, AWS
  EventBridge, etc.) has actually been wired up and exercised end-to-end in this environment;
  only the endpoint's own auth/idempotency/batching was verified directly (via curl-equivalent
  fetch calls in Playwright), not a real external cron provider's delivery.
- **The offer/TAT compliance threshold is a report parameter, not a stored org policy.** The PRD
  names no fixed SLA number for §11.12's compliance reporting, so `tatThresholdDays` is supplied
  per report-run/export rather than configured once at the organization level.
- **The report PDF export is a plain text table, not a laid-out grid.** `pdf-lib` is a low-level
  PDF-writing library with no table-layout engine of its own; building one was out of scope for
  satisfying "export to PDF" on a report already viewable on-screen and exportable as XLSX/CSV.
- **The `HrisProvider` abstraction has exactly one implementation.** `src/lib/hris/` mirrors
  `StorageProvider`'s shape (interface + one real implementation + env-driven factory,
  `HRIS_PROVIDER` defaulting to `"structured_export"`), but no real HRIS API connector exists
  yet — `HandoffDeliveryMethod.API_PUSH` is a recognized value nothing ever writes. Same
  intentional "infrastructure exists, only a later integration effort writes the other value"
  pattern as `EmailLogStatus`/`positionsFilledCount` before Module 6.
- **The `JobBoardProvider` abstraction has exactly one implementation.** `src/lib/job-boards/`
  mirrors `StorageProvider`/`HrisProvider`/`MailProvider`'s shape (interface + one real
  implementation + env-driven factory, `JOB_BOARD_PROVIDER` defaulting to `"mock"`), but no real
  board API connector (LinkedIn, Indeed, Naukri, etc.) exists yet — per-board partner credentials
  are not available in this environment (§12). Same intentional "infrastructure exists, only a
  later integration effort writes the other value" pattern as `HrisProvider`/`MailProvider`.
- **Inbound applications are staff-recorded, not received via a live board webhook/API.** §7
  explicitly scopes this app to have no public, unauthenticated career-site/apply page, so
  `receiveInboundApplication` is a session-authenticated "record what the board told you" entry
  point rather than an unauthenticated webhook receiver. A future real board integration's own
  webhook handler or polling adapter would call this exact function once board credentials exist.
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
