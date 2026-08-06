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

## Remaining modules

Per the PRD's §11 module breakdown and §14 roadmap, not yet started:

| PRD § | Module | Roadmap phase |
| --- | --- | --- |
| 11.2 | Candidate Database | V1 — Core Parity |
| 11.3 | Sourcing & Job Board Distribution | V1 — Core Parity |
| 11.4 | Pipeline & Application Management | V1 — Core Parity |
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

- **`positionsFilledCount` does not yet auto-update.** The column exists and defaults to `0`
  as the PRD requires, but no code writes to it — that requires the future Application/Offer
  modules that actually fill positions.
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
- **Three of the eight seeded Controlled Lists have no starter values.**
  `REJECTION_REASON`, `CANDIDATE_SOURCE`, and `DOCUMENT_TYPE` exist as lists (so the future
  Candidate/Pipeline modules can populate them) but carry no values yet, since nothing in
  Module 1 or 2 consumes them.
- **`JOB_HOLD_REASON`, `JOB_CLOSE_REASON`, `JOB_CANCEL_REASON` have no seeded starter values
  either.** The lists exist and are required by the status-transition validation, but an admin
  must add at least one value to each via the admin UI before a job can actually be put on
  hold, closed, or cancelled in a fresh environment.
- **A discrepancy between malformed and well-formed unauthorized requests.** An unauthenticated
  or under-permissioned `POST`/`PATCH`/`PUT` with an empty or malformed body returns `400`
  (Zod validation runs before the service's permission check) rather than `403`; a
  well-formed-but-unauthorized payload correctly returns `403`. Investigated in Phase 5 and
  left as-is: it leaks no sensitive information and does not affect functionality, per the
  Phase 5 instruction not to change behavior absent a real bug.
- **No hard delete for jobs**, by design (Phase 1 decision) — a job unwanted in Draft or later
  is cancelled via the status endpoint, not removed from the database.

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
