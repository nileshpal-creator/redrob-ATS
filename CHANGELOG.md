# Changelog

## Module 13 — V1 gap closure: GDPR retention, Dashboard/Report Builder, Template Designer, UI gaps

A concise V1 PRD status check identified the remaining M-priority gaps in priority order; see
[project-status.md](docs/project-status.md#module-13--v1-gap-closure-gdpr-retention-dashboardreport-builder-template-designer-ui-gaps)
for the full write-up. No P2/Future work and no real external integrations were touched.

### Added

- **GDPR retention/soft-delete workflow (§13).** `DataErasureRequest` two-tier request/decide
  model (ANONYMIZE or HARD_DELETE); org-configurable `Organization.candidateRetentionDays`
  driving a new `runDueRetentionSweeps` scheduler consumer (5th, alongside Module 12's four);
  `/admin/data-retention` admin screen; erasure-request actions on the candidate detail page.
- **Full generic Dashboard/Report Builder (§10.5).** `Dashboard`/`DashboardWidget` models; a
  query engine re-running each target entity's own already-scoped, already-field-sanitized
  `list*()` service on every render (never a second query path, never frozen at save time) over
  any core entity or active custom object; `COUNT`/`SUM`/`AVG`/`MIN`/`MAX` aggregation, optional
  grouping, and a `WorkflowCondition`-shaped filter DSL; `/dashboards` list + builder/viewer
  pages.
- **Full Template Designer (§10.4), scoped to the generic email-template engine** — no
  offer-letter/document generation (§14 tags that P2). `CommunicationTemplateVersion` adds
  version history, submit → approve/reject (new `COMMUNICATION_TEMPLATE:APPROVE` action),
  rollback, and per-language variants, additive on top of `CommunicationTemplate`'s existing
  columns every send path already reads. `renderTemplate()` gained `{{#if}}`/`{{else}}`
  conditional blocks. `Candidate.preferredLanguage` + `resolvePersonalizedTemplateContent`
  personalize `bulkEmailApplications` automatically. New "Versions" dialog on
  `/admin/communication-templates`.
- **Role-permission matrix now shows an `APPROVE` column** and greys out any action
  `getApplicableActions` says doesn't apply to that resource, instead of offering every action
  unconditionally.
- **Candidate bulk-import column-mapping wizard.** Upload → map columns → preview → commit;
  the original case-insensitive-name auto-detect is kept as the suggested default and as the
  fallback for direct API callers that skip the mapping step.

### Fixed

- **Stale documentation claim**: the Job list/detail "aging indicator" was already implemented
  since Module 2's original commit; `docs/project-status.md` incorrectly listed it as a gap.

## Post-launch — Priority-A audit gap closure

A PRD-audit pass after Module 12 confirmed 13 gaps as Priority A. All 13 are closed; see
[project-status.md](docs/project-status.md#post-launch-priority-a-audit-gap-closure) for the
full PRD mapping and [architecture.md](docs/architecture.md#post-launch-priority-a-audit-gap-closure)
for the design rationale behind the three largest pieces.

### Added

- **Field-level permission enforcement**, actually applied. `src/lib/authz/field-sanitizer.ts`
  (`sanitizeForRead`/`sanitizeManyForRead`/`assertWritableFields`) is now called from Candidate,
  Job, and Offer's own read/write paths — `getFieldAccess` previously resolved a role's per-field
  map but nothing consumed it.
- **Configurable multi-step approval chains** for Job and Offer. New shared module
  `src/lib/services/approvals.ts`; `ApprovalStepConfig` CRUD at `/admin/approval-chains`
  (`PUT /api/approval-steps/[entityType]`, gated at ALL scope specifically); chains snapshotted
  onto `JobApproval`/`OfferApproval` at submit time so a later config edit never rewrites an
  in-progress chain.
- **Offer `LAPSED` status + automatic expiry.** `src/lib/services/offer-expiry.ts`
  (`runDueOfferExpirations`) added as a 4th consumer to the existing Module 12 scheduler
  orchestrator (`runScheduledWork`).
- **Offer `designation`/`location` fields** on create/update and the detail UI.
- **Org-configurable Offer SLA/TAT threshold.** `Organization.offerTatThresholdDays`, editable at
  `/admin/offer-settings`; a report run/export can still override it per-request.
- **Interview calendar view** (`/interviews`), reusing the existing `GET /api/interviews` list
  endpoint with added `jobId`/`recruiterId`/`dateFrom`/`dateTo` filters.
- **Interview reschedule/cancel email notifications**, via the existing
  `MailProvider`/`CommunicationTemplate` infrastructure.
- **Interview panel double-booking protection** and a new **`NO_SHOW`** interview status.
- **Custom object record/relation CRUD.** `src/lib/services/custom-object-records.ts` +
  `/api/custom-object-records/*` + a new "Records" tab on the existing Custom Fields & Objects
  admin page — `CustomObjectRecord`/`CustomObjectRelation` existed in the schema since Module 1
  but had no service, API, or UI until now.

### Fixed

- **Candidate phone duplicate race.** Two concurrent creates with the same phone could both pass
  the pre-check `findFirst` and both insert; now caught via the actual insert's unique-constraint
  violation (P2002), not just the prior check.
- **Post-handoff read-only enforcement gaps.** Closed the remaining gaps in
  `assertApplicationNotHandedOff`'s coverage across the services that mutate a post-handoff
  Application.

### Security

- **Custom object relations were gated only by `CUSTOM_OBJECT_DEFINITION`, not by the *target*
  entity's own RBAC scope.** Caught by an independent security review before this work was
  considered done. `createCustomObjectRelation` previously only checked that the target Job/
  Candidate/Application/Interview/Offer/Handoff *existed*, not that the caller could actually
  `READ` that specific record in their own scope — meaning a caller with only
  `CUSTOM_OBJECT_DEFINITION:UPDATE` at ALL scope could link to, and enumerate the existence of,
  entities entirely outside their own access. Fixed by resolving each target's own ownership
  field and running the same `can(context, relatedEntityType, "READ", { ownerId })` check every
  direct-access route in this app already runs, before a relation can be created.

## Module 12 — Scheduler Infrastructure (§11.5 reminders / §11.12 scheduled reports / §10.2 TIME_IN_STAGE)

### Added

- `InterviewReminder` + 2 enums (`prisma/schema.prisma`): §11.5's "automatic email reminders to
  candidate and panel at configurable intervals," built from scratch (no reminder code existed
  anywhere previously). One row per (interview occurrence, lead time, recipient) — candidate and
  each active panelist get their own row, mirroring `ApplicationEmailLog`'s one-row-per-recipient
  shape. Claimed via create-then-catch-unique-violation on first attempt, a status-guarded
  `updateMany` to reclaim a retry or a stale abandoned attempt — the same two idempotency idioms
  `WorkflowExecution`/`removeJobPosting` each already establish separately, combined here for the
  first time. `scheduledAtFingerprint` (a reschedule-sensitive snapshot of `scheduledAt`) makes a
  reschedule naturally invalidate old reminders and enable new ones with no explicit
  invalidation step, the same pattern `WorkflowExecution`'s own fingerprint already establishes.
  Up to 3 retry attempts with exponential backoff, then a permanent `FAILED`; a missing email is
  an immediate permanent failure, never retried.
- `Organization.interviewReminderLeadMinutes` (`Int[]`, default `[1440, 60]`): one org-wide list
  of configurable lead times, reusing this app's one existing global-settings singleton rather
  than a new settings table. `/admin/interview-reminders` (a fixed preset checklist) and
  `GET`/`PATCH /api/organization` are the first things to actually use `Organization`'s
  RBAC-registered-but-previously-unused entity slot.
- `src/lib/mail/test-failure-provider.ts` + `MAIL_PROVIDER=test_failure`: a real, factory-wired
  `MailProvider` implementation whose entire purpose is deterministically failing a send (marked
  by a recipient-address substring, optionally with a fail-count) — `ConsoleMailProvider` never
  fails, so retry/backoff/permanent-failure logic would otherwise be untestable.
- `src/lib/scheduler/auth.ts` + `src/lib/scheduler/run.ts` + `POST /api/scheduler/run`: the one
  HTTP entry point external scheduling infrastructure (Vercel Cron, AWS EventBridge, a
  Railway/Render cron job, a Kubernetes CronJob, Windows Task Scheduler, or a plain OS crontab)
  calls to run all three scheduler-driven consumers. Authenticated via `Authorization: Bearer
  <SCHEDULER_SECRET>`, compared as SHA-256 digests through `crypto.timingSafeEqual` (avoiding the
  length-mismatch timing signal a bare `timingSafeEqual` would leak) — the one deliberate
  exception to this app's otherwise session-only API convention (`withApiHandler` is not used
  here), since a cron provider has no user session to present. Each of the three consumers is
  invoked concurrently and isolated — one throwing never blocks or hides the other two's results.
- Batch caps added to all three consumers: interview reminders (200 interviews / 500 sends per
  call), scheduled reports (100), and `runDueTimeInStageWorkflows`'s per-definition
  due-application fetch (200) — a large backlog is worked off over several scheduler ticks, not
  one unbounded pass.
- Audit actions: `INTERVIEW_REMINDER_SENT`, `INTERVIEW_REMINDER_FAILED`, `SCHEDULER_RUN`
  (`actorId: null` — no human actor for a machine-triggered run), `ORGANIZATION_SETTINGS_UPDATED`.
- Automated test coverage: `interview-reminders.service.test.ts` (13 tests),
  `scheduler-auth.test.ts` (11 tests), `scheduler-run.test.ts` under `tests/lib/` (4 tests) and
  under `tests/api/` (6 tests), plus 3 new regression tests in
  `scheduled-reports.service.test.ts` (2 concurrency/batch tests plus a third added during
  self-review, below). Full regression suite: 561 tests passing project-wide.

### Fixed

- `runDueScheduledReports` (Module 9) had a real, previously-undocumented duplicate-send gap:
  check-then-act on `lastRunAt` meant two overlapping scheduler ticks could both send the same
  report. The first fix attempt used only `SavedReport.version` as an atomic claim, which closed
  the race between two callers reading the *identical* stale version simultaneously — but an
  independent adversarial review found it did not close a subtler one: a second tick starting
  **after** the first tick's claim but **before** its send finished would see the
  already-incremented version (not stale to it) and the still-old `lastRunAt` (still "due" to
  it), and would send again. Fixed by stamping `lastRunAt: now` as part of the *same* atomic
  claim that increments `version`, not after the send — closing the gap for the send's entire
  duration. A new regression test reproduces the exact scenario.
- `sendOneReminder` looked up its `CommunicationTemplate` via `findFirst` once per recipient — an
  N+1 query found during self-review: up to `MAX_REMINDERS_PER_RUN` (500) separate queries per
  scheduler tick for only two distinct template names. Fixed by resolving both templates once
  per `runDueInterviewReminders` call into a small `Map`, threaded through instead of re-queried.
- `runDueScheduledReports`'s `orderBy: { lastRunAt: "asc" }` could let never-run reports
  (`lastRunAt: null`) starve behind an already-run backlog once due reports exceed the new batch
  cap, since Postgres's default `NULLS LAST` on ascending order puts them last. Fixed with
  `orderBy: { lastRunAt: { sort: "asc", nulls: "first" } }`.

## Module 11 — Sourcing & Job Board Distribution (PRD §11.3)

### Added

- `JobPosting` + `JobPostingStatus` enum (`prisma/schema.prisma`): one row per (job, board),
  status-toggled (`POSTED`/`REMOVED`/`FAILED`) rather than append-only — re-posting after a
  removal updates the same row instead of creating a new one. `@@unique([jobId, sourceId])` is
  the real guard against a double-post race, not a pre-check; a `P2002` on the create path is
  caught and turned into a `ConflictError`. `JobPosting.sourceId` reuses the existing
  `CANDIDATE_SOURCE` controlled list rather than introducing a parallel `JOB_BOARD` list.
- `JobBoardProvider` abstraction (`src/lib/job-boards/`): `post`/`remove` interface, an env-driven
  factory (`JOB_BOARD_PROVIDER`, default `"mock"`), and `MockJobBoardProvider` — the same
  interface + factory shape as `StorageProvider`/`HrisProvider`/`MailProvider`. No real board API
  connector exists yet (per-board partner credentials aren't available in this environment, §12).
- `Application.sourcedFromPostingId` (optional FK → `JobPosting`): which specific posting drove
  *this* application, distinct from `Candidate.sourceId`'s broader "where this person originally
  came from." Threaded through as an internal-only third parameter to `createApplication`, not
  part of the public `ApplicationCreateInput` schema, so the existing `POST /api/applications`
  route can't be made to claim an attribution it has no way to validate.
- `receiveInboundApplication` (`src/lib/services/job-postings.ts`): a staff-authenticated "record
  what the board told you" entry point — this app has no public, unauthenticated career-site/
  apply page (§7) to receive a live webhook on. Creates (or, on a phone match, reuses) the
  candidate tagged with the posting's board as source, and an application via the same
  `createApplication` every other path uses, landing in the job's first active pipeline stage.
- `createReferral` (`src/lib/services/referrals.ts`): a combined candidate+application creation
  step with source fixed to the `CANDIDATE_SOURCE` list's existing "Referral" value — §11.3's
  "referral capture as a distinct source type."
- `createJobPosting`/`removeJobPosting`/`listJobPostings` reuse `JOB:<action>` RBAC scoped to
  `Job.primaryRecruiterId` (the same reuse `PipelineStage`'s own endpoints already establish) —
  no new `JOB_POSTING` permission resource.
- API routes: `GET`/`POST /api/jobs/[id]/postings`, `POST /api/job-postings/[id]/remove`,
  `POST /api/job-postings/[id]/inbound`, `POST /api/referrals`.
- Frontend: a "Job board postings" card on the Job detail page (post/status/remove/record
  inbound application), a "Refer a candidate" dialog, and a "Source" column/field on the
  Applications list and detail page.
- Audit actions: `JOB_POSTING_CREATED`, `JOB_POSTING_REMOVED`,
  `JOB_POSTING_INBOUND_APPLICATION_RECEIVED`, `CANDIDATE_REFERRED`.
- Automated test coverage: `job-postings.service.test.ts` (21 tests — CRUD, RBAC, the DRAFT/OPEN
  status guard, duplicate-posting rejection, re-post-after-removal row reuse, three concurrency
  tests, the mock provider's deterministic FAILED path, inbound-intake candidate reuse without
  overwriting an existing source), `referrals.service.test.ts` (5 tests), `job-posting.test.ts`
  (9 validation-schema tests). Full regression suite: 524 tests passing project-wide.

### Fixed

- `job-postings-card.tsx`'s and `refer-candidate-dialog.tsx`'s `<Label>` elements had no
  `htmlFor`/matching input `id`, unlike the codebase's established convention (e.g.
  `candidate-form.tsx`'s `htmlFor="candidate-name"`/`id="candidate-name"` pairs) — a real
  accessibility regression (screen readers and label-click-to-focus wouldn't associate the label
  with its field), caught during Playwright browser verification when `getByLabel` couldn't find
  the fields. Fixed by adding `htmlFor`/`id` pairs to every field in both components.
- `createJobPosting`'s reactivate-an-existing-row branch (re-posting after a `REMOVED`/`FAILED`
  posting) used a plain `update()` with no status precondition, unlike `removeJobPosting`'s
  status-guarded `updateMany` — an independent adversarial review agent found that two concurrent
  re-posts of the same board could silently clobber each other's `externalPostingId`/audit trail
  instead of the second one being cleanly rejected. Fixed by making that branch a status-guarded
  `updateMany` (`WHERE id AND status != 'POSTED'`), the same shape `removeJobPosting` already
  uses, plus a new concurrency test.

## Module 10 — Workflow & Automation Builder (PRD §10.2)

### Added

- `WorkflowDefinition` + `WorkflowDefinitionVersion` (`prisma/schema.prisma`): a
  trigger/conditions/actions configuration, versioned the same way `Job`'s status history is —
  every save of trigger/conditions/actions creates a new version row and re-points
  `activeVersionId`, never mutating history, so §10.2's "full version history... with the
  ability to roll back" holds exactly. Business-record tier (`OWN`/`TEAM`/`ALL` scope on
  `createdById`, optimistic-locking `version`, deactivate-don't-delete) rather than
  admin-metadata tier like `CommunicationTemplate` — an automation can send email, reassign
  ownership, or create approval-gated tasks with no further per-action human review, so it gets
  the same guardrails as `Job`/`Offer`.
- Four trigger types (`STAGE_CHANGE`, `FIELD_UPDATE`, `TIME_IN_STAGE`, `FORM_SUBMISSION`),
  AND-only conditions against `Application.customFields` (5 operators: `EQUALS`/`NOT_EQUALS`/
  `GREATER_THAN`/`LESS_THAN`/`CONTAINS`), and five action types (`SEND_EMAIL`, `CREATE_TASK`,
  `CHANGE_FIELD`, `REASSIGN_OWNER`, `REQUEST_APPROVAL`) — `src/lib/validations/workflow.ts`
  (discriminated unions per trigger/action type) and `src/lib/services/workflows.ts` (the
  evaluate/execute engine).
- `WorkflowExecution` ledger: a `(workflowDefinitionVersionId, applicationId, fingerprint)`
  unique constraint is the real guard against double-firing the same occurrence of a trigger —
  the same "let the database's unique constraint be the guard, not a check-then-act pre-check"
  pattern `createOffer`/`createCommunicationTemplate` already establish. Required specifically
  for `TIME_IN_STAGE`, which has no single triggering write and would otherwise re-fire every
  time an external scheduler calls `POST /api/workflows/run-due`.
- `WorkflowTask`: the row `CREATE_TASK`/`REQUEST_APPROVAL` both produce. Two independent access
  paths — whoever manages the owning Application, or the task's own assignee, unconditionally
  (unlike Interview's panelist path, a Hiring Manager routed a `REQUEST_APPROVAL` task may hold
  no `APPLICATION:UPDATE` grant at all and must still be able to act on it). Status-guarded
  `updateMany` (`OPEN` → `DONE`/`APPROVED`/`REJECTED`) is the optimistic-concurrency guard here,
  in place of a dedicated `version` column.
- Cross-module hooks into `src/lib/services/applications.ts`: `transitionApplication`
  (STAGE_CHANGE), `updateApplication` (FIELD_UPDATE, diffed against the actually-changed
  `customFields` keys — a no-op re-save of the same value must not re-fire), and
  `createApplication` (FORM_SUBMISSION) all call `evaluateApplicationWorkflows` after their own
  write has committed, outside that write's transaction and with its own errors caught and only
  logged — a misbehaving automation must never roll back or fail the user's own action that
  triggered it.
- `/admin/workflows`: list, create, and edit pages with a trigger/condition/action builder form
  and version history + rollback UI. `/tasks` ("My Tasks"): every `WorkflowTask` assigned to the
  viewer across every application, essential since an automation-created task would otherwise
  only be discoverable by whoever happens to open the exact application it lives on. A Tasks
  card on the Application detail page. Both nav entries are gated by real RBAC grants
  (`WORKFLOW_DEFINITION:READ`), not restricted to super-admin like `CommunicationTemplate`'s
  admin screens — Recruiter/Recruiting Manager/Hiring Manager are seeded with real grants.
- Candidate timeline gains `task_created`/`task_completed`/`task_approved`/`task_rejected` item
  types, derived from `WorkflowTask` joined through `Application`.
- `ENTITY.WORKFLOW_DEFINITION` + seeded default grants (`Recruiter`: CREATE/READ ALL, UPDATE
  OWN; `Recruiting Manager`: CREATE ALL, READ/UPDATE TEAM; `Hiring Manager`: READ ALL only).
- Automated test coverage: `workflow.test.ts` (Zod schemas), `workflow-definitions.service.test.ts`
  (CRUD, versioning, rollback, optimistic-locking concurrency, RBAC scoping),
  `workflow-tasks.service.test.ts` (dual access path, status-guarded concurrency, decide
  outcomes), `workflows.service.test.ts` (all three event-driven trigger hooks, all 5 condition
  operators, all 5 action types, the `WorkflowExecution` idempotency guard against both a
  repeat `runDueTimeInStageWorkflows` call and an identical-fingerprint re-evaluation, and
  partial-failure handling when one action in a multi-action workflow fails).

### Fixed

- Two stale comments (`src/lib/jobs/status-machine.ts`, `src/lib/offers/status-machine.ts`)
  said the generic Workflow & Automation Builder "is Module 8" — a leftover from before Module 8
  became the Communication Hub. Corrected to Module 10.
- `claimExecutionSlot` originally returned the full created `WorkflowExecution` row (or `null`)
  from a `.catch()`-guarded `.create()` call, but its callers treated the return value as a
  plain execution-id string — caught by `tsc`, not a test failure, before it ever ran. Fixed by
  changing the return type to `Promise<string | null>` and extracting `.id` internally.
- The `/admin/workflows/[id]` edit page cast the stored version's `conditions`/`actions` JSON
  straight into the builder form's editable-draft shape (`as never`), but the two shapes don't
  match — stored actions have optional `description`/`dueInDays` and a `string | number`
  condition value; the draft shape requires every field present as a plain string, since that's
  what a controlled `<Input>` needs. Left as a cast, this would have rendered `undefined` into
  controlled inputs (a React console warning and a blank field) and made the "did the config
  actually change" comparison always report a false positive whenever a numeric condition value
  was in play — spawning a needless new `WorkflowDefinitionVersion` on every save, even a
  metadata-only one. Fixed with real `toActionDraft`/`toConditionDraft` normalizers, used both
  to initialize form state and to compute the unchanged-check.

## Module 9 — Reporting & Analytics (PRD §11.12)

### Added

- Four pre-built reports (`src/lib/services/reports.ts`), each reusing the underlying entity's
  own `:READ` permission and OWN/TEAM/ALL scope rather than a new blanket `REPORT` resource —
  the same pattern `candidate-export.ts` already documents for `CANDIDATE:READ`:
  - Pipeline funnel & conversion, per job — current-stage distribution plus a cumulative
    "ever reached" count per stage (via `ApplicationEvent`), with recruiter/source/date filters.
  - Time-to-fill & time-to-offer, in business days, per job/department.
  - Recruiter productivity & workload — snapshot counts (open jobs, active applications) mixed
    with date-ranged activity counts (interviews scheduled, offers extended, hires).
  - Offer/TAT compliance — `Offer.createdAt` → the approved `OfferApproval.decidedAt`, the one
    leg of Offer's lifecycle with an immutable, never-overwritten timestamp; the compliance
    threshold is a report parameter, not an invented stored org policy.
- `src/lib/reporting/business-days.ts`: business-day arithmetic reading
  `Organization.workingDays`/`Holiday` — seeded in Module 1 as "foundation for future SLA/TAT
  clocks" but never consumed by any service until now.
- `SavedReport` entity (§10.5): name + `reportType` + `filters` (validated per-type via Zod, same
  "JSON shape validated at the service boundary" convention as `Job.customFields`), optional
  `DAILY`/`WEEKLY` schedule with recipient emails and an export format. Business-record tier
  (`OWN`/`TEAM`/`ALL` scope on `createdById`, optimistic-locking `version`, hard-deletable) —
  not admin-metadata tier like `CommunicationTemplate`, since scheduling arbitrary-recipient
  emails is a meaningfully more sensitive capability than reading a template. Deliberately not a
  generic drag-and-drop dashboard builder over arbitrary entities/custom fields — the same scope
  cut Module 8 made for the Template Designer.
- `src/lib/services/scheduled-reports.ts` (`runDueScheduledReports`): re-applies each
  `SavedReport`'s *creator's* own RBAC scope at run time (`getSessionContextForUser`), the same
  row-level-security guarantee ad-hoc report viewing gets. No cron/queue infrastructure exists in
  this app — this is the real business logic; the periodic trigger itself is external infra this
  pass doesn't provide.
- `src/lib/services/report-export.ts`: XLSX/CSV (ExcelJS, same pattern as `candidate-export.ts`)
  and PDF (`pdf-lib`, a new dependency — a plain text table, not a full layout engine) export for
  every report type, plus `GET /api/reports/export`.
- `MailMessage` gained an optional `attachments` field (`src/lib/mail/provider.ts`) — the first
  sender that needs one; `ConsoleMailProvider` logs attachment names/sizes.
- `ENTITY.SAVED_REPORT` + seeded default grants (`Recruiter`: CREATE/READ ALL, UPDATE/DELETE OWN;
  `Recruiting Manager`: CREATE ALL, READ/UPDATE/DELETE TEAM; `Hiring Manager`: READ ALL only —
  scheduling is a meaningfully different capability than approving).
- `/reports`: tabs for all four pre-built reports plus a Saved Reports tab (list, schedule
  edit, delete) — gated on `JOB:READ` or `OFFER:READ`, whichever a given tab needs.
- Automated test coverage: `business-days.test.ts` (pure unit, weekday/holiday/recurring-holiday
  edge cases), `report.test.ts` (Zod schemas), `reports.service.test.ts` (all four reports'
  computations + RBAC scoping against a deterministic fixture), `saved-reports.service.test.ts`
  (CRUD, optimistic locking, RBAC, schedule/recipient cross-field validation),
  `scheduled-reports.service.test.ts` (due-detection for DAILY/WEEKLY, deactivated-creator
  handling), `report-export.service.test.ts` (real parseable XLSX/CSV/PDF output, audit logging).

### Fixed

- `getPipelineFunnelReport`'s "reached stage N" cumulative count only ever consulted
  `ApplicationEvent.toStageId` — an application's *initial* stage (assigned at creation, before
  its first move) never appears as any event's `toStageId`, since nothing "moved it into" a
  stage it started at. Any application that had since progressed past its starting stage
  silently disappeared from that stage's reached count. Fixed by also folding in
  `fromStageId`, caught while writing `reports.service.test.ts`'s fixture.
- `getRecruiterProductivityReport` ran 5 `count()` queries *per recruiter* in a
  `recruiters.map(async ...)` loop — an N+1 that scales with team size for TEAM/ALL-scope
  viewers. Rewritten to 5 flat `groupBy` queries across every recruiter at once, independent of
  how many recruiters are in scope.

## Module 8 — Communication Hub (PRD §11.10)

### Added

- `CommunicationTemplate` entity: admin-managed name/subject/body, `{{key}}` variable
  substitution via the existing `renderTemplate()` helper — the minimal slice of the Template
  Designer (§10.4) that §11.10's own M-requirement needs, not the full designer (multi-language
  variants, conditional blocks, version history + approval workflow stay deferred to §10.4's own
  future module). No hard delete — deactivate via `isActive`, same convention as `PipelineStage`.
- `src/lib/mail/`: a `MailProvider` delivery abstraction mirroring `StorageProvider`/
  `HrisProvider` — interface, one real implementation (`ConsoleMailProvider`), and an env-driven
  factory (`MAIL_PROVIDER`, defaulting to `"console"`). A real Gmail/Outlook API connector (§12)
  needs OAuth credentials out of scope for this pass.
- `bulkEmailApplications` rewritten: `{applicationIds, subject, body}` becomes
  `{applicationIds, templateId}` — the template is resolved and validated once upfront (a shared
  precondition for the whole call, not a per-item concern), then rendered per recipient and
  actually sent, with `ApplicationEmailLog` written directly as `SENT`/`FAILED` instead of a
  permanent `PENDING`.
- `/admin/communication-templates`: admin CRUD (create/edit subject-body/activate-deactivate) —
  reading the list is open to any authenticated user (mirrors `listCustomFieldDefinitions`, since
  the bulk-email picker needs it), mutations require `COMMUNICATION_TEMPLATE:CREATE/UPDATE`.
- Candidate timeline gains `email_sent`/`email_failed` item types, derived from
  `ApplicationEmailLog` joined through `Application` — completing §11.2's own "every application,
  interview, offer, note and email in one view" requirement, which had shipped everything except
  the email part until now.
- Automated test coverage: validation tests, `CommunicationTemplateService` tests (RBAC via the
  existing `isSuperAdmin` bypass — no new seeded grant needed — open read, duplicate-name
  rejection, active/inactive filtering), and `bulkEmailApplications` tests (successful send,
  no-candidate-email skip, unknown/inactive template rejection, candidate-timeline integration).

### Fixed

- `createCommunicationTemplate`'s duplicate-name pre-check had the same race as `createOffer`
  warns about in its own comment — two concurrent creates with the same name could both pass the
  `findUnique` check and one would hit the database's unique constraint as an unhandled 500.
  Added the same `P2002 -> ValidationError` catch `createOffer` uses.
- `communicationTemplateQuerySchema` used `z.coerce.boolean()` for `isActive`, which maps the
  *string* `"false"` to `true` (`Boolean("false")` is truthy) — query params always arrive as
  strings. Replaced with an explicit `"true"`/`"false"` string match.

## Module 7 — Onboarding Handoff / HRIS Integration (PRD §11.7)

### Added

- `HandoffRecord` entity: created only as a side effect of an `Offer` reaching `ACCEPTED`
  (`transitionOffer`'s ACCEPT branch) — no dedicated create endpoint. Holds a frozen snapshot of
  the candidate profile, final offer terms, and the candidate's full document manifest,
  captured once and never re-read live afterward (same "render/capture once" choice as
  `ApplicationEmailLog.subject/body`).
- `HandoffDeliveryAttempt`: an append-only row per delivery attempt (the automatic attempt on
  creation, plus every retry), never overwritten — the same history-preserving shape as
  `OfferApproval`/`JobStatusChange`.
- `src/lib/hris/`: an `HrisProvider` delivery abstraction mirroring `StorageProvider`'s shape —
  interface, one real implementation (`StructuredExportProvider`), and an env-driven factory
  (`HRIS_PROVIDER`, defaulting to `"structured_export"`). `HandoffDeliveryMethod.API_PUSH` is a
  recognized value reserved for a future real HRIS connector, never written today.
- **Retry**: `POST /api/handoffs/[id]/retry` re-pushes the handoff's frozen payload — it does
  not re-snapshot the candidate/offer — and is only accepted while the handoff is in
  `EXCEPTION`.
- **Acknowledgement**: `POST /api/handoffs/[id]/acknowledge` lets HR/Onboarding confirm a
  `DELIVERED` package as `ACCEPTED` or report an `EXCEPTION` with a reason, reusing the existing
  global `APPROVE` permission action rather than adding a new one.
- **Read-only archive**: `assertApplicationNotHandedOff` (exported from the new
  `src/lib/services/handoffs.ts`) is called from `transitionApplication`, `scheduleInterview`,
  and `createOffer` — once a handoff reaches `ACCEPTED`, the linked `Application` can no longer
  be rejected/withdrawn/re-staged and can't collect a new interview or offer. No new field on
  `Application` itself; `HandoffRecord.status` is the sole source of truth.
- **Timeline integration**: the candidate timeline gains `handoff_initiated`/
  `handoff_delivered`/`handoff_accepted`/`handoff_exception` item types, derived from
  `HandoffRecord`/`HandoffDeliveryAttempt` rows joined through `Application`, the same pattern
  Offer/Interview use.
- **Frontend**: an Onboarding Handoff card on the Application detail page (status badge,
  delivery-attempt history, retry and confirm-receipt/report-exception actions, all
  permission-gated) and an archive banner with hidden create-affordances once a handoff is
  `ACCEPTED`.
- Role permission seed: Recruiter/Recruiting Manager get retry authority over handoffs they
  initiated (by accepting the triggering offer); HR/Onboarding gets read access plus the
  acknowledgement (`APPROVE`) grant.
- Automated test coverage: 34 new tests (service layer — creation via both the successful and
  the deterministic missing-candidate-email failure path, access control, retry/acknowledge
  state gating, optimistic-locking conflicts, two concurrency tests, cascade-delete, cross-module
  read-only enforcement, candidate-timeline integration; validation-schema edge cases).

### Fixed

- `HandoffRecord` was missing an index on `initiatedById` (the column `listHandoffs`'s OWN/TEAM
  scope filters on) — added, matching `Offer.createdById`'s equivalent index.
- `tests/services/offers.service.test.ts`'s "walks DRAFT -> ... -> ACCEPTED" test and its
  `afterAll` cleanup predated this module's `HandoffRecord` foreign key on `Offer` — both now
  clean up the handoff row before deleting the offer it points at.

## Module 4 — Applications / Candidate Pipeline (PRD §11.4)

### Added

- `Application` entity: links one `Candidate` to one `Job`, holding the current pipeline stage,
  a dedicated reassignable owner (defaulting from the job's primary recruiter), an outcome
  (`ACTIVE`/`REJECTED`/`WITHDRAWN`, orthogonal to stage and terminal once non-`ACTIVE`), custom
  fields, and an internal optimistic-locking `version` counter. Deliberately no unique
  constraint on `(candidateId, jobId)` — re-applying is allowed, only warned about.
- `PipelineStage`: a dedicated, ordered, per-job configuration model (not an enum, not a
  Controlled List) — add, rename, reorder, deactivate, and reactivate stages per job. New jobs
  get a default four-stage pipeline (`Applied`, `Screening`, `Interview`, `Offer`) automatically
  at creation. Never hard-deleted; "removing" a stage deactivates it.
- `ApplicationEvent`: an immutable history row for every stage move and outcome change, modeled
  on `JobStatusChange`, written inside the same transaction as the `Application` it describes.
- `ApplicationEmailLog`: bulk email logging — originally infrastructure-only (every row wrote
  `status: PENDING`, nothing sent); Module 8 (Communication Hub) completed the wire — see its
  own entry below.
- **Pipeline board and list**: a per-job Kanban board (one column per active stage,
  `@dnd-kit/core`-powered drag-and-drop isolated to a single component) and a filterable list,
  sharing one dataset per job via a tab switch.
- **Drag-and-drop stage moves**: dragging a card to another column moves that application's
  stage, with an optimistic UI update and rollback on failure.
- **Bulk actions**: stage move, reject, withdraw, and queue-email across multiple selected
  applications at once (from either the per-job list or the global Applications list), each
  target processed independently with a `{ succeeded, failed }` best-effort response.
- **Duplicate warnings**: `GET /api/applications/duplicates` and the `priorApplications` field on
  the create response surface every prior application for the same candidate/job pair — a
  non-blocking warning, never an enforcement point (§11.4's stated "warn," not "block").
- **Timeline integration**: `getCandidateTimeline` (Module 3) gains four new item types —
  `application_created`, `application_stage_changed`, `application_rejected`,
  `application_withdrawn` — merged with existing note items, using the extensible `{ type, ... }`
  contract Module 3 built for exactly this.
- `ApplicationService` (`src/lib/services/applications.ts`) and `PipelineStageService`
  (`src/lib/services/pipeline-stages.ts`): all Application/pipeline business logic and
  permission checks, behind thin API routes — `GET/POST /api/applications`,
  `GET/PATCH /api/applications/[id]`, `GET /api/applications/duplicates`,
  `POST /api/applications/[id]/transition`, `POST /api/applications/bulk/transition`,
  `POST /api/applications/bulk/email`, `GET/PUT /api/jobs/[id]/pipeline-stages`.
- `src/lib/templates/render.ts`: a minimal `{{key}}`-substitution helper for bulk email's
  subject/body rendering — deliberately not the full Template Designer (§10.4).
- `APPLICATION` registered as a `CUSTOM_FIELD_CAPABLE_ENTITY`, reusing the existing
  `buildCustomFieldValueSchema` engine unchanged.
- Seven new audit action strings: `application.created`, `application.updated`,
  `application.stage_changed`, `application.rejected`, `application.withdrawn`,
  `application.bulk_transitioned`, `application.bulk_email_requested`, plus
  `pipeline_stages.updated`.
- Cross-module wiring: `createJob` (Module 2) now seeds the default four-stage pipeline
  transactionally at job creation; `deleteCandidate` (Module 3) now blocks with a `400` if the
  candidate has any applications; `prisma/backfill-pipeline-stages.ts` is a one-time, idempotent
  script that seeds the default pipeline onto any job created before this module shipped.
- Seed data: Application permission grants for Recruiter (`CREATE`/`READ` at `ALL`, `UPDATE` at
  `OWN`), Hiring Manager (`READ` at `ALL`), and Recruiting Manager (`CREATE` at `ALL`,
  `READ`/`UPDATE` at `TEAM`) — no role gets `DELETE`, since there is no delete endpoint.
- `@dnd-kit/core` added as a dependency for the pipeline board's drag-and-drop.
- Frontend: an Applications nav item (permission-gated); a global filterable `/applications`
  list with row selection and a shared `BulkActionToolbar`; an `/applications/new` create form
  (candidate/job pickers, a non-blocking duplicate warning, custom fields); an
  `/applications/[id]` detail page (owner reassignment, single-record transition actions,
  stage/outcome history, editable custom fields); a `/jobs/[id]/pipeline` page (Board/List tabs)
  and an ordered `PipelineStageEditor`; `DataTable` extended with opt-in, backward-compatible
  row-selection support; "New application" cross-links from the Candidate and Job detail pages.
- Automated tests: `ApplicationService` and `PipelineStageService` (31 tests, covering
  validation, RBAC, optimistic locking, duplicate warnings, outcome/terminal-state rules, the
  pipeline-stage replace algorithm, and bulk best-effort semantics) and the Application Zod
  validation schemas (21 tests), bringing the project's automated test count from 139 to 191.

### Fixed

Found during Phase 5 testing:

- **`PipelineStage` name uniqueness could throw an unhandled `500`, and permanently blocked
  reusing a deactivated stage's name.** The original `@@unique([jobId, name])` constraint was
  unconditional, which caused two problems: (1) swapping two stages' names in one
  `replacePipelineStages` call transiently violated the constraint mid-transaction, since the
  sequential update loop had no collision-avoidance ordering; (2) once a stage bearing a given
  name was deactivated, that name could never be reused by a new active stage — directly
  contradicting the "deactivate, don't delete, can bring back" design. Fixed with a hand-written
  **partial unique index** (`pipeline_stage_active_name_unique`, scoped to `WHERE "isActive" =
  true`) replacing the full constraint, plus a **three-phase write order** in
  `replacePipelineStages`: rename every kept stage to a collision-proof temporary name derived
  from its own id, deactivate every removed stage, then apply the real target names — clearing
  both kinds of transient collision before any real name is written. Verified with two new
  regression tests and a live pointer-driven Playwright pass against the dev database.
- **Drag-and-drop rollback could silently undo an unrelated card's already-confirmed move.**
  `job-pipeline-client.tsx`'s `handleDropCard` snapshotted the *entire* applications array before
  an optimistic stage-move update and restored that stale full-array snapshot on failure — if a
  second card was dragged while the first card's request was still in flight, and the first
  request later failed, the full-array rollback would wipe out the second card's confirmed move
  along with it. Fixed to scope both the optimistic update and the rollback to only the affected
  card, via functional `setState` updates that always apply against the latest state rather than
  a stale snapshot. Verified end-to-end with a Playwright test that forces a concurrent
  server-side stage change mid-drag and confirms only the dragged card reverts.

### Documentation corrections

- Corrected a further pre-existing inaccuracy carried in this documentation set since Module 2:
  `REJECTION_REASON`, `JOB_HOLD_REASON`, `JOB_CLOSE_REASON`, and `JOB_CANCEL_REASON` have in fact
  carried seeded starter values since Module 1's seed script — the docs previously and
  incorrectly stated that none of the four had any seeded values.

---

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
