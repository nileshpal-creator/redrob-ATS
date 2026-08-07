import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Personas from PRD §8. Seeded so the org has a usable role set on day one;
// nothing in the codebase treats these names specially — admins can rename,
// delete (non-system roles), or add arbitrary roles from the Roles screen.
const SYSTEM_ROLES = [
  {
    name: "System Administrator",
    description: "Full configuration access. Cannot be locked out by permission edits.",
    isSuperAdmin: true,
  },
  { name: "Recruiter", description: "Owns requisitions end to end." },
  { name: "Hiring Manager", description: "Raises/approves requisitions, reviews shortlists." },
  { name: "Interviewer", description: "Conducts interviews, submits structured feedback." },
  { name: "Recruiting Manager", description: "Oversees a team's requisitions and workload." },
  { name: "HR / Onboarding", description: "Receives the finalized candidate record after offer acceptance." },
] as const;

// §11.13 controlled lists. Values here are sensible starting points, not
// hardcoded business logic — admins manage all of this from /admin/settings
// once that screen ships alongside the modules that consume these lists.
const CONTROLLED_LISTS = [
  {
    key: "REJECTION_REASON",
    label: "Rejection Reasons",
    values: ["Skills mismatch", "Compensation mismatch", "Withdrew", "Position on hold", "Selected another candidate"],
  },
  {
    key: "CANDIDATE_SOURCE",
    label: "Candidate Sources",
    values: ["Referral", "LinkedIn", "Indeed", "Naukri", "Career Site", "Agency", "Direct Application"],
  },
  {
    key: "DOCUMENT_TYPE",
    label: "Document Types",
    values: ["Resume", "Cover Letter", "Offer Letter", "Signed Agreement", "ID Proof", "Other"],
  },
  {
    key: "LOCATION",
    label: "Locations",
    values: ["Remote", "Head Office"],
  },
  // Module 2 — Requisition / Job Management (§11.1, per-decision controlled lists)
  {
    key: "DEPARTMENT",
    label: "Departments",
    values: ["Engineering", "Sales", "Marketing", "Finance", "Human Resources", "Operations"],
  },
  {
    key: "JOB_HOLD_REASON",
    label: "Job Hold Reasons",
    values: ["Budget freeze", "Awaiting leadership sign-off", "Business priority change"],
  },
  {
    key: "JOB_CLOSE_REASON",
    label: "Job Close Reasons",
    values: ["Position filled", "Position no longer needed", "Merged with another requisition"],
  },
  {
    key: "JOB_CANCEL_REASON",
    label: "Job Cancel Reasons",
    values: ["Duplicate requisition", "Budget not approved", "Role no longer required"],
  },
  // Module 5 — Interview Management (§11.5)
  {
    key: "INTERVIEW_CANCELLATION_REASON",
    label: "Interview Cancellation Reasons",
    values: ["Candidate withdrew", "Scheduling conflict", "Candidate no-show", "Position on hold"],
  },
  // Module 6 — Offer Management (§11.6). Shared between DECLINE and REVOKE,
  // the same "one outcome + one reason list" choice Application makes for
  // REJECTED/WITHDRAWN — see Offer.outcomeReasonId in schema.prisma.
  {
    key: "OFFER_OUTCOME_REASON",
    label: "Offer Outcome Reasons",
    values: [
      "Candidate accepted another offer",
      "Compensation mismatch",
      "Candidate unresponsive",
      "Position no longer available",
      "Budget freeze",
    ],
  },
] as const;

// Module 2 default grants — without these, no role but System Administrator
// (which bypasses checks entirely) could do anything with Jobs. Ownership
// resolves solely against Job.primaryRecruiterId (the PRD's Job data model
// has no separate approver field), so scopes mirror each persona's PRD
// description (§8) against that one anchor: Recruiter owns their own
// requisitions (OWN); Hiring Manager approves broadly, not tied to being
// the assigned recruiter (ALL); Recruiting Manager oversees their team
// (TEAM, resolved via the primary recruiter's manager chain).
const JOB_ROLE_PERMISSIONS = [
  { role: "Recruiter", action: "CREATE", scope: "ALL" },
  { role: "Recruiter", action: "READ", scope: "ALL" },
  { role: "Recruiter", action: "UPDATE", scope: "OWN" },
  { role: "Hiring Manager", action: "CREATE", scope: "ALL" },
  { role: "Hiring Manager", action: "READ", scope: "ALL" },
  { role: "Hiring Manager", action: "APPROVE", scope: "ALL" },
  { role: "Recruiting Manager", action: "CREATE", scope: "ALL" },
  { role: "Recruiting Manager", action: "READ", scope: "TEAM" },
  { role: "Recruiting Manager", action: "UPDATE", scope: "TEAM" },
  { role: "Recruiting Manager", action: "APPROVE", scope: "TEAM" },
] as const;

// Assigning a recruiter to a job (§11.1) requires seeing a directory of
// colleagues to assign — a distinct need from administering user accounts
// (create/deactivate), which stays System-Administrator-only. ALL scope
// here only grants READ, not any write capability.
const DIRECTORY_ROLE_PERMISSIONS = [
  { role: "Recruiter", resource: "USER", action: "READ", scope: "ALL" },
  { role: "Hiring Manager", resource: "USER", action: "READ", scope: "ALL" },
  { role: "Recruiting Manager", resource: "USER", action: "READ", scope: "ALL" },
] as const;

// Module 3 default grants — ownership resolves against
// Candidate.createdById (§9 gives Candidate no "assigned recruiter"
// concept, unlike Job; see the Phase 1 decision). Recruiter and Recruiting
// Manager are the only roles §11.2's requirements are actually about
// (creating, owning, and overseeing candidate records); Hiring Manager and
// HR/Onboarding interact with candidates through Application/Offer-level
// views that don't exist until a later module, so no default grant is
// seeded for them here — an admin can add one via the Roles screen if a
// given organization wants it sooner.
const CANDIDATE_ROLE_PERMISSIONS = [
  { role: "Recruiter", action: "CREATE", scope: "ALL" },
  { role: "Recruiter", action: "READ", scope: "ALL" },
  { role: "Recruiter", action: "UPDATE", scope: "OWN" },
  { role: "Recruiter", action: "DELETE", scope: "OWN" },
  { role: "Recruiting Manager", action: "CREATE", scope: "ALL" },
  { role: "Recruiting Manager", action: "READ", scope: "TEAM" },
  { role: "Recruiting Manager", action: "UPDATE", scope: "TEAM" },
  { role: "Recruiting Manager", action: "DELETE", scope: "TEAM" },
] as const;

// Module 4 default grants — ownership resolves against Application.ownerId
// (§9 names `owner` as its own Application field, distinct from the
// candidate/job themselves — the Phase 2 decision mirrors Job's
// primaryRecruiterId anchor rather than Candidate's ownerless design).
// Recruiter owns the applications they work end to end; Hiring Manager
// reviews shortlists broadly (§8) but has no application-mutation need, so
// gets READ only; Recruiting Manager oversees their team. There is no
// DELETE grant for anyone — Application has no delete endpoint, mirroring
// Job's "no hard delete" precedent rather than Candidate's.
const APPLICATION_ROLE_PERMISSIONS = [
  { role: "Recruiter", action: "CREATE", scope: "ALL" },
  { role: "Recruiter", action: "READ", scope: "ALL" },
  { role: "Recruiter", action: "UPDATE", scope: "OWN" },
  { role: "Hiring Manager", action: "READ", scope: "ALL" },
  { role: "Recruiting Manager", action: "CREATE", scope: "ALL" },
  { role: "Recruiting Manager", action: "READ", scope: "TEAM" },
  { role: "Recruiting Manager", action: "UPDATE", scope: "TEAM" },
] as const;

// Module 5 default grants — ownership resolves against Interview.scheduledById
// for the scheduling side (Recruiter/Recruiting Manager), mirroring every
// prior module's single-column ownership anchor. Interviewer is a second,
// independent access path: an OWN-scope grant here is resolved by
// assertInterviewAccess (src/lib/services/interviews.ts) against panelist
// membership instead of scheduledById — an interviewer didn't schedule the
// interview, but still needs to read it and file feedback on it. No DELETE
// grant for anyone — Interview has no delete endpoint, same "no hard delete"
// precedent as Job/Application (cancel via status, not removal).
const INTERVIEW_ROLE_PERMISSIONS = [
  { role: "Recruiter", action: "CREATE", scope: "ALL" },
  { role: "Recruiter", action: "READ", scope: "ALL" },
  { role: "Recruiter", action: "UPDATE", scope: "OWN" },
  { role: "Hiring Manager", action: "READ", scope: "ALL" },
  { role: "Recruiting Manager", action: "CREATE", scope: "ALL" },
  { role: "Recruiting Manager", action: "READ", scope: "TEAM" },
  { role: "Recruiting Manager", action: "UPDATE", scope: "TEAM" },
  { role: "Interviewer", action: "READ", scope: "OWN" },
  { role: "Interviewer", action: "UPDATE", scope: "OWN" },
] as const;

// Module 6 — Offer Management (§11.6). Ownership resolves solely against
// Offer.createdById (the recruiter who drafted it), same choice as Job's
// primaryRecruiterId: Hiring Manager approves without being tied to having
// drafted the offer (ALL-scope APPROVE, mirroring their JOB APPROVE grant).
// "HR / Onboarding" (seeded in Module 1, unused until now) gets read-only
// visibility, matching its PRD description exactly — it receives the
// finalized record, it doesn't act in the offer lifecycle. No DELETE grant
// for anyone — same "no hard delete, retire via status" precedent as
// Job/Application/Interview.
const OFFER_ROLE_PERMISSIONS = [
  { role: "Recruiter", action: "CREATE", scope: "ALL" },
  { role: "Recruiter", action: "READ", scope: "ALL" },
  { role: "Recruiter", action: "UPDATE", scope: "OWN" },
  { role: "Hiring Manager", action: "READ", scope: "ALL" },
  { role: "Hiring Manager", action: "APPROVE", scope: "ALL" },
  { role: "Recruiting Manager", action: "CREATE", scope: "ALL" },
  { role: "Recruiting Manager", action: "READ", scope: "TEAM" },
  { role: "Recruiting Manager", action: "UPDATE", scope: "TEAM" },
  { role: "HR / Onboarding", action: "READ", scope: "ALL" },
] as const;

async function main() {
  const organization = await prisma.organization.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      name: "My Organization",
    },
  });
  console.log(`Organization ready: ${organization.name}`);

  for (const role of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: {
        name: role.name,
        description: role.description,
        isSystem: true,
        isSuperAdmin: "isSuperAdmin" in role ? role.isSuperAdmin : false,
      },
    });
  }
  console.log(`Seeded ${SYSTEM_ROLES.length} system roles`);

  for (const list of CONTROLLED_LISTS) {
    const createdList = await prisma.controlledList.upsert({
      where: { key: list.key },
      update: {},
      create: { key: list.key, label: list.label, isSystem: true },
    });

    for (const [index, value] of list.values.entries()) {
      await prisma.controlledListValue.upsert({
        where: { listId_value: { listId: createdList.id, value } },
        update: {},
        create: { listId: createdList.id, value, label: value, sortOrder: index },
      });
    }
  }
  console.log(`Seeded ${CONTROLLED_LISTS.length} controlled lists`);

  for (const grant of JOB_ROLE_PERMISSIONS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: grant.role } });
    await prisma.rolePermission.upsert({
      where: { roleId_resource_action: { roleId: role.id, resource: "JOB", action: grant.action } },
      update: { scope: grant.scope },
      create: { roleId: role.id, resource: "JOB", action: grant.action, scope: grant.scope },
    });
  }
  console.log(`Seeded ${JOB_ROLE_PERMISSIONS.length} default Job role permissions`);

  for (const grant of DIRECTORY_ROLE_PERMISSIONS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: grant.role } });
    await prisma.rolePermission.upsert({
      where: { roleId_resource_action: { roleId: role.id, resource: grant.resource, action: grant.action } },
      update: { scope: grant.scope },
      create: { roleId: role.id, resource: grant.resource, action: grant.action, scope: grant.scope },
    });
  }
  console.log(`Seeded ${DIRECTORY_ROLE_PERMISSIONS.length} directory role permissions`);

  for (const grant of CANDIDATE_ROLE_PERMISSIONS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: grant.role } });
    await prisma.rolePermission.upsert({
      where: { roleId_resource_action: { roleId: role.id, resource: "CANDIDATE", action: grant.action } },
      update: { scope: grant.scope },
      create: { roleId: role.id, resource: "CANDIDATE", action: grant.action, scope: grant.scope },
    });
  }
  console.log(`Seeded ${CANDIDATE_ROLE_PERMISSIONS.length} default Candidate role permissions`);

  for (const grant of APPLICATION_ROLE_PERMISSIONS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: grant.role } });
    await prisma.rolePermission.upsert({
      where: { roleId_resource_action: { roleId: role.id, resource: "APPLICATION", action: grant.action } },
      update: { scope: grant.scope },
      create: { roleId: role.id, resource: "APPLICATION", action: grant.action, scope: grant.scope },
    });
  }
  console.log(`Seeded ${APPLICATION_ROLE_PERMISSIONS.length} default Application role permissions`);

  for (const grant of INTERVIEW_ROLE_PERMISSIONS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: grant.role } });
    await prisma.rolePermission.upsert({
      where: { roleId_resource_action: { roleId: role.id, resource: "INTERVIEW", action: grant.action } },
      update: { scope: grant.scope },
      create: { roleId: role.id, resource: "INTERVIEW", action: grant.action, scope: grant.scope },
    });
  }
  console.log(`Seeded ${INTERVIEW_ROLE_PERMISSIONS.length} default Interview role permissions`);

  for (const grant of OFFER_ROLE_PERMISSIONS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: grant.role } });
    await prisma.rolePermission.upsert({
      where: { roleId_resource_action: { roleId: role.id, resource: "OFFER", action: grant.action } },
      update: { scope: grant.scope },
      create: { roleId: role.id, resource: "OFFER", action: grant.action, scope: grant.scope },
    });
  }
  console.log(`Seeded ${OFFER_ROLE_PERMISSIONS.length} default Offer role permissions`);

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.warn(
      "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping admin user bootstrap.",
    );
    return;
  }

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { name: "System Administrator" },
  });

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "System Administrator",
      passwordHash,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });

  console.log(`Bootstrapped admin user: ${adminEmail}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
