import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, ValidationError } from "@/lib/errors";
import {
  createJob,
  getJobById,
  listJobs,
  transitionJobStatus,
  updateJob,
  updateJobRecruiters,
} from "@/lib/services/jobs";
import type { JobCreateInput } from "@/lib/validations/job";

function contextFor(user: {
  id: string;
  name: string;
  email: string;
  roles: { id: string; name: string; isSuperAdmin: boolean }[];
}): SessionContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    roles: user.roles,
    isSuperAdmin: user.roles.some((role) => role.isSuperAdmin),
  };
}

describe("JobService", () => {
  let recruiterRoleId: string;
  let hiringManagerRoleId: string;
  let noAccessRoleId: string;

  let recruiter: SessionContext;
  let otherRecruiter: SessionContext;
  let hiringManager: SessionContext;
  let noAccessUser: SessionContext;

  let departmentId: string;
  let locationId: string;
  let holdReasonId: string;
  let closeReasonId: string;
  let cancelReasonId: string;

  const baseInput = (): JobCreateInput =>
    ({
      title: "Senior Backend Engineer",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "HIGH",
      positionsCount: 2,
      mustHaveCriteria: ["5+ years backend"],
      goodToHaveCriteria: [],
      recruiterUserIds: [],
      primaryRecruiterUserId: "",
    }) as JobCreateInput;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "OWN" },
              { resource: "JOB", action: "UPDATE", scope: "OWN" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    // No per-job ownership field anchors Hiring Manager approval (the PRD's
    // Job data model has no such field) — ALL scope is the correct default,
    // matching prisma/seed.ts.
    const hiringManagerRole = await prisma.role.create({
      data: {
        name: "Test Hiring Manager",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "JOB", action: "APPROVE", scope: "ALL" },
            ],
          },
        },
      },
    });
    hiringManagerRoleId = hiringManagerRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [recruiterUser, otherRecruiterUser, hiringManagerUser, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "Recruiter One", email: "recruiter1@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Recruiter Two", email: "recruiter2@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Hiring Manager", email: "hm1@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "No Access", email: "noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterUser.id, roleId: recruiterRoleId },
        { userId: otherRecruiterUser.id, roleId: recruiterRoleId },
        { userId: hiringManagerUser.id, roleId: hiringManagerRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    recruiter = contextFor({ ...recruiterUser, roles: [{ id: recruiterRoleId, name: "Test Recruiter", isSuperAdmin: false }] });
    otherRecruiter = contextFor({
      ...otherRecruiterUser,
      roles: [{ id: recruiterRoleId, name: "Test Recruiter", isSuperAdmin: false }],
    });
    hiringManager = contextFor({
      ...hiringManagerUser,
      roles: [{ id: hiringManagerRoleId, name: "Test Hiring Manager", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test No Access", isSuperAdmin: false }],
    });

    // Keys must match what src/lib/services/jobs.ts validates against — DEPARTMENT
    // and LOCATION, same as the real seed data (this is the dedicated ats_test
    // database, so there's no collision with dev/seed data to worry about).
    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const holdList = await prisma.controlledList.create({
      data: { key: "JOB_HOLD_REASON", label: "Hold Reasons", values: { create: { value: "budget", label: "Budget freeze" } } },
    });
    holdReasonId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: holdList.id } })).id;

    const closeList = await prisma.controlledList.create({
      data: { key: "JOB_CLOSE_REASON", label: "Close Reasons", values: { create: { value: "filled", label: "Position filled" } } },
    });
    closeReasonId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: closeList.id } })).id;

    const cancelList = await prisma.controlledList.create({
      data: { key: "JOB_CANCEL_REASON", label: "Cancel Reasons", values: { create: { value: "dup", label: "Duplicate" } } },
    });
    cancelReasonId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: cancelList.id } })).id;
  });

  afterAll(async () => {
    await prisma.jobStatusChange.deleteMany({});
    await prisma.jobRecruiterAssignment.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.controlledListValue.deleteMany({
      where: { list: { key: { in: ["DEPARTMENT", "LOCATION", "JOB_HOLD_REASON", "JOB_CLOSE_REASON", "JOB_CANCEL_REASON"] } } },
    });
    await prisma.controlledList.deleteMany({
      where: { key: { in: ["DEPARTMENT", "LOCATION", "JOB_HOLD_REASON", "JOB_CLOSE_REASON", "JOB_CANCEL_REASON"] } },
    });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [recruiterRoleId, hiringManagerRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({ where: { email: { in: ["recruiter1@test.local", "recruiter2@test.local", "hm1@test.local", "noaccess@test.local"] } } });
    await prisma.role.deleteMany({ where: { id: { in: [recruiterRoleId, hiringManagerRoleId, noAccessRoleId] } } });
    // No prisma.$disconnect() here — this file has more describe blocks after
    // this one that reuse the same shared client; disconnecting mid-file
    // would break them. See the file-level afterAll at the bottom instead.
  });

  it("creates a job with default counters and no writable positionsFilledCount", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });

    expect(job.status).toBe("DRAFT");
    expect(job.positionsFilledCount).toBe(0);
    expect(job.version).toBe(0);
    expect(job.primaryRecruiterId).toBe(recruiter.userId);
  });

  it("rejects creation from a user without JOB:CREATE", async () => {
    await expect(
      createJob(noAccessUser, {
        ...baseInput(),
        recruiterUserIds: [recruiter.userId],
        primaryRecruiterUserId: recruiter.userId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets the primary recruiter (OWN scope) update their job, but not a peer recruiter", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });

    const updated = await updateJob(recruiter, job.id, { version: job.version, title: "Staff Backend Engineer" });
    expect(updated.title).toBe("Staff Backend Engineer");

    await expect(
      updateJob(otherRecruiter, job.id, { version: updated.version, title: "Hijacked" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a stale version with ConflictError", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });

    await updateJob(recruiter, job.id, { version: job.version, title: "First edit" });

    await expect(
      updateJob(recruiter, job.id, { version: job.version, title: "Stale edit" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("walks the full approval lifecycle and enforces who can approve", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });

    const submitted = await transitionJobStatus(recruiter, job.id, { action: "SUBMIT", version: job.version });
    expect(submitted.status).toBe("PENDING_APPROVAL");

    // Recruiter has no JOB:APPROVE grant at all — must be rejected regardless of ownership.
    await expect(
      transitionJobStatus(recruiter, job.id, { action: "APPROVE", version: submitted.version }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const approved = await transitionJobStatus(hiringManager, job.id, {
      action: "APPROVE",
      version: submitted.version,
    });
    expect(approved.status).toBe("OPEN");
  });

  it("requires a reason for HOLD/CLOSE/CANCEL and rejects illegal transitions", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });

    // CLOSE is not a legal transition from DRAFT.
    await expect(
      transitionJobStatus(recruiter, job.id, { action: "CLOSE", version: job.version, reasonId: closeReasonId }),
    ).rejects.toBeInstanceOf(ValidationError);

    const submitted = await transitionJobStatus(recruiter, job.id, { action: "SUBMIT", version: job.version });
    const approved = await transitionJobStatus(hiringManager, job.id, { action: "APPROVE", version: submitted.version });

    // No reasonId supplied — service-level guard, independent of the route's zod check.
    await expect(
      transitionJobStatus(recruiter, job.id, { action: "HOLD", version: approved.version } as never),
    ).rejects.toBeInstanceOf(ValidationError);

    const held = await transitionJobStatus(recruiter, job.id, {
      action: "HOLD",
      version: approved.version,
      reasonId: holdReasonId,
    });
    expect(held.status).toBe("ON_HOLD");

    const cancelled = await transitionJobStatus(recruiter, job.id, {
      action: "CANCEL",
      version: held.version,
      reasonId: cancelReasonId,
    });
    expect(cancelled.status).toBe("CANCELLED");

    const history = await getJobById(recruiter, job.id);
    expect(history.statusChanges.map((change) => change.toStatus)).toEqual([
      "CANCELLED",
      "ON_HOLD",
      "OPEN",
      "PENDING_APPROVAL",
    ]);
  });

  it("reassigning the primary recruiter transfers OWN-scope access", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });

    const reassigned = await updateJobRecruiters(recruiter, job.id, {
      version: job.version,
      assignments: [
        { userId: recruiter.userId, isPrimary: false },
        { userId: otherRecruiter.userId, isPrimary: true },
      ],
    });
    expect(reassigned.primaryRecruiterId).toBe(otherRecruiter.userId);

    // The old primary recruiter no longer has OWN-scope access.
    await expect(
      updateJob(recruiter, job.id, { version: reassigned.version, title: "No longer mine" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const updated = await updateJob(otherRecruiter, job.id, {
      version: reassigned.version,
      title: "Now mine",
    });
    expect(updated.title).toBe("Now mine");
  });

  it("scopes listJobs to OWN records for a plain Recruiter grant", async () => {
    const mine = await createJob(recruiter, {
      ...baseInput(),
      title: "Mine",
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });
    await createJob(otherRecruiter, {
      ...baseInput(),
      title: "Not mine",
      recruiterUserIds: [otherRecruiter.userId],
      primaryRecruiterUserId: otherRecruiter.userId,
    });

    const { jobs } = await listJobs(recruiter, { page: 1, pageSize: 25 });
    const ids = jobs.map((job) => job.id);
    expect(ids).toContain(mine.id);
    expect(jobs.every((job) => job.primaryRecruiterId === recruiter.userId)).toBe(true);
  });

  it("denies listJobs entirely for a role with no JOB:READ grant", async () => {
    await expect(listJobs(noAccessUser, { page: 1, pageSize: 25 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  // --- Edge cases: cross-list reference integrity ---

  it("rejects a departmentId that belongs to a different controlled list (e.g. LOCATION)", async () => {
    await expect(
      createJob(recruiter, {
        ...baseInput(),
        departmentId: locationId, // wrong list on purpose
        recruiterUserIds: [recruiter.userId],
        primaryRecruiterUserId: recruiter.userId,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a reasonId that belongs to the wrong reason list for the transition", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });
    const submitted = await transitionJobStatus(recruiter, job.id, { action: "SUBMIT", version: job.version });
    const approved = await transitionJobStatus(hiringManager, job.id, { action: "APPROVE", version: submitted.version });

    // holdReasonId is a JOB_HOLD_REASON value; CLOSE expects JOB_CLOSE_REASON.
    await expect(
      transitionJobStatus(recruiter, job.id, { action: "CLOSE", version: approved.version, reasonId: holdReasonId }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an inactive user as a recruiter", async () => {
    const inactiveUser = await prisma.user.create({
      data: {
        name: "Inactive Recruiter",
        email: "inactive@test.local",
        passwordHash: "x",
        isActive: false,
      },
    });

    await expect(
      createJob(recruiter, {
        ...baseInput(),
        recruiterUserIds: [inactiveUser.id],
        primaryRecruiterUserId: inactiveUser.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await prisma.user.delete({ where: { id: inactiveUser.id } });
  });

  it("rejects a job linking itself as its own parent", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });

    await expect(
      updateJob(recruiter, job.id, { version: job.version, parentJobId: job.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a nonexistent parent job", async () => {
    await expect(
      createJob(recruiter, {
        ...baseInput(),
        parentJobId: "does-not-exist",
        recruiterUserIds: [recruiter.userId],
        primaryRecruiterUserId: recruiter.userId,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("links a valid parent requisition", async () => {
    const parent = await createJob(recruiter, {
      ...baseInput(),
      title: "Parent req",
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });
    const child = await createJob(recruiter, {
      ...baseInput(),
      title: "Split role",
      parentJobId: parent.id,
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });

    const parentDetail = await getJobById(recruiter, parent.id);
    expect(parentDetail.childJobs.map((c) => c.id)).toContain(child.id);
  });

  it("service layer rejects zero primary recruiters even bypassing the Zod schema", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId, otherRecruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });

    await expect(
      updateJobRecruiters(recruiter, job.id, {
        version: job.version,
        assignments: [
          { userId: recruiter.userId, isPrimary: false },
          { userId: otherRecruiter.userId, isPrimary: false },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // --- Database integrity ---

  it("increments version by exactly 1 on every mutation and appends one JobStatusChange per transition", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });
    expect(job.version).toBe(0);

    const afterUpdate = await updateJob(recruiter, job.id, { version: 0, title: "v1" });
    expect(afterUpdate.version).toBe(1);

    const afterSubmit = await transitionJobStatus(recruiter, job.id, { action: "SUBMIT", version: 1 });
    expect(afterSubmit.version).toBe(2);

    const statusChangeCount = await prisma.jobStatusChange.count({ where: { jobId: job.id } });
    expect(statusChangeCount).toBe(1);
  });

  it("enforces at most one primary recruiter per job at the database level (partial unique index)", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId, otherRecruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });

    // otherRecruiter is already isPrimary=false from createJob; force a second
    // primary directly via raw SQL, bypassing the service layer entirely, to
    // prove the database itself — not just application code — rejects it.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "JobRecruiterAssignment" SET "isPrimary" = true WHERE "jobId" = $1 AND "userId" = $2`,
        job.id,
        otherRecruiter.userId,
      ),
    ).rejects.toThrow();
  });

  it("cascades JobRecruiterAssignment and JobStatusChange deletion when a Job is deleted", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });
    await transitionJobStatus(recruiter, job.id, { action: "SUBMIT", version: job.version });

    await prisma.job.delete({ where: { id: job.id } });

    expect(await prisma.jobRecruiterAssignment.count({ where: { jobId: job.id } })).toBe(0);
    expect(await prisma.jobStatusChange.count({ where: { jobId: job.id } })).toBe(0);
  });

  // --- Audit log ---

  it("records an AuditLog entry with the correct actor for every job action", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    });

    const created = await prisma.auditLog.findFirst({
      where: { action: "job.created", entityId: job.id },
    });
    expect(created?.actorId).toBe(recruiter.userId);

    const updated = await updateJob(recruiter, job.id, { version: job.version, title: "Audited title" });
    const updateLog = await prisma.auditLog.findFirst({
      where: { action: "job.updated", entityId: job.id },
    });
    expect(updateLog?.actorId).toBe(recruiter.userId);

    await updateJobRecruiters(recruiter, job.id, {
      version: updated.version,
      assignments: [{ userId: recruiter.userId, isPrimary: true }],
    });
    const recruitersLog = await prisma.auditLog.findFirst({
      where: { action: "job.recruiters_updated", entityId: job.id },
    });
    expect(recruitersLog?.actorId).toBe(recruiter.userId);

    const submitted = await transitionJobStatus(recruiter, job.id, { action: "SUBMIT", version: updated.version + 1 });
    const statusLog = await prisma.auditLog.findFirst({
      where: { action: "job.status_changed", entityId: job.id },
      orderBy: { createdAt: "desc" },
    });
    expect(statusLog?.actorId).toBe(recruiter.userId);
    expect(submitted.status).toBe("PENDING_APPROVAL");
  });
});

describe("JobService — configurable multi-step approval", () => {
  let recruiterRoleId: string;
  let hmRoleId: string;
  let financeRoleId: string;

  let recruiter: SessionContext;
  let hiringManager: SessionContext;
  let financeApprover: SessionContext;

  let departmentId: string;
  let locationId: string;

  const jobInput = (): JobCreateInput =>
    ({
      title: "Multi-Step Approval Job",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [],
      primaryRecruiterUserId: "",
    }) as JobCreateInput;

  async function configureTwoStepChain() {
    await prisma.approvalStepConfig.deleteMany({ where: { entityType: "JOB" } });
    await prisma.approvalStepConfig.createMany({
      data: [
        { entityType: "JOB", stepOrder: 1, name: "Hiring Manager review", requiredRoleId: hmRoleId },
        { entityType: "JOB", stepOrder: 2, name: "Finance review", requiredRoleId: financeRoleId },
      ],
    });
  }

  async function submitJob() {
    const job = await createJob(recruiter, { ...jobInput(), recruiterUserIds: [recruiter.userId], primaryRecruiterUserId: recruiter.userId });
    return transitionJobStatus(recruiter, job.id, { action: "SUBMIT", version: job.version });
  }

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test MS Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "JOB", action: "UPDATE", scope: "OWN" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const hmRole = await prisma.role.create({
      data: {
        name: "Test MS Hiring Manager",
        rolePermissions: {
          createMany: { data: [{ resource: "JOB", action: "READ", scope: "ALL" }, { resource: "JOB", action: "APPROVE", scope: "ALL" }] },
        },
      },
    });
    hmRoleId = hmRole.id;

    const financeRole = await prisma.role.create({
      data: {
        name: "Test MS Finance Approver",
        rolePermissions: {
          createMany: { data: [{ resource: "JOB", action: "READ", scope: "ALL" }, { resource: "JOB", action: "APPROVE", scope: "ALL" }] },
        },
      },
    });
    financeRoleId = financeRole.id;

    const [recruiterUser, hmUser, financeUser] = await Promise.all([
      prisma.user.create({ data: { name: "MS Recruiter", email: "ms-recruiter@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "MS Hiring Manager", email: "ms-hm@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "MS Finance Approver", email: "ms-finance@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterUser.id, roleId: recruiterRoleId },
        { userId: hmUser.id, roleId: hmRoleId },
        { userId: financeUser.id, roleId: financeRoleId },
      ],
    });

    recruiter = contextFor({ ...recruiterUser, roles: [{ id: recruiterRoleId, name: "Test MS Recruiter", isSuperAdmin: false }] });
    hiringManager = contextFor({ ...hmUser, roles: [{ id: hmRoleId, name: "Test MS Hiring Manager", isSuperAdmin: false }] });
    financeApprover = contextFor({ ...financeUser, roles: [{ id: financeRoleId, name: "Test MS Finance Approver", isSuperAdmin: false }] });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;
  });

  afterAll(async () => {
    // ApprovalStepConfig is genuinely global state — every other test file's
    // own JOB SUBMIT calls assume "no configured chain" (legacy single-step)
    // unless they set one up themselves. Leaving a JOB chain configured here
    // would silently change every subsequent file's SUBMIT behavior.
    await prisma.approvalStepConfig.deleteMany({ where: { entityType: "JOB" } });
    await prisma.jobApproval.deleteMany({});
    await prisma.jobStatusChange.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [recruiterRoleId, hmRoleId, financeRoleId] } } });
    await prisma.user.deleteMany({ where: { email: { in: ["ms-recruiter@test.local", "ms-hm@test.local", "ms-finance@test.local"] } } });
    await prisma.role.deleteMany({ where: { id: { in: [recruiterRoleId, hmRoleId, financeRoleId] } } });
  });

  it("creates one PENDING JobApproval row per configured step at SUBMIT, snapshotting name/role", async () => {
    await configureTwoStepChain();
    const submitted = await submitJob();

    expect(submitted.approvals).toHaveLength(2);
    expect(submitted.approvals.map((a) => ({ stepOrder: a.stepOrder, stepName: a.stepName, status: a.status }))).toEqual([
      { stepOrder: 1, stepName: "Hiring Manager review", status: "PENDING" },
      { stepOrder: 2, stepName: "Finance review", status: "PENDING" },
    ]);

    await prisma.jobApproval.deleteMany({ where: { jobId: submitted.id } });
    await prisma.job.delete({ where: { id: submitted.id } });
  });

  it("walks a 2-step chain: step 1 approval leaves status PENDING_APPROVAL, step 2 approval opens the job", async () => {
    await configureTwoStepChain();
    const submitted = await submitJob();

    const afterStep1 = await transitionJobStatus(hiringManager, submitted.id, { action: "APPROVE", version: submitted.version });
    expect(afterStep1.status).toBe("PENDING_APPROVAL");
    expect(afterStep1.version).toBe(submitted.version);
    expect(afterStep1.approvals[0].status).toBe("APPROVED");
    expect(afterStep1.approvals[0].approverId).toBe(hiringManager.userId);
    expect(afterStep1.approvals[1].status).toBe("PENDING");

    const afterStep2 = await transitionJobStatus(financeApprover, submitted.id, { action: "APPROVE", version: afterStep1.version });
    expect(afterStep2.status).toBe("OPEN");
    expect(afterStep2.approvals[1].status).toBe("APPROVED");
    expect(afterStep2.approvals[1].approverId).toBe(financeApprover.userId);

    await prisma.jobApproval.deleteMany({ where: { jobId: submitted.id } });
    await prisma.job.delete({ where: { id: submitted.id } });
  });

  it("blocks the Hiring Manager from deciding the Finance-only step, even though they hold JOB:APPROVE", async () => {
    await configureTwoStepChain();
    const submitted = await submitJob();
    const afterStep1 = await transitionJobStatus(hiringManager, submitted.id, { action: "APPROVE", version: submitted.version });

    await expect(
      transitionJobStatus(hiringManager, submitted.id, { action: "APPROVE", version: afterStep1.version }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await prisma.jobApproval.deleteMany({ where: { jobId: submitted.id } });
    await prisma.job.delete({ where: { id: submitted.id } });
  });

  it("REJECT at step 1 fails the whole chain immediately and marks the untouched step 2 SKIPPED", async () => {
    await configureTwoStepChain();
    const submitted = await submitJob();

    const rejected = await transitionJobStatus(hiringManager, submitted.id, { action: "REJECT", version: submitted.version });
    expect(rejected.status).toBe("DRAFT");
    expect(rejected.approvals[0].status).toBe("REJECTED");
    expect(rejected.approvals[1].status).toBe("SKIPPED");

    await prisma.jobApproval.deleteMany({ where: { jobId: submitted.id } });
    await prisma.job.delete({ where: { id: submitted.id } });
  });

  it("a later config change never rewrites an in-progress job's already-snapshotted chain", async () => {
    await configureTwoStepChain();
    const submitted = await submitJob();

    // Admin clears the chain entirely after this job already submitted.
    await prisma.approvalStepConfig.deleteMany({ where: { entityType: "JOB" } });

    // The in-flight job still requires both original steps, in order.
    await expect(
      transitionJobStatus(financeApprover, submitted.id, { action: "APPROVE", version: submitted.version }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const afterStep1 = await transitionJobStatus(hiringManager, submitted.id, { action: "APPROVE", version: submitted.version });
    expect(afterStep1.status).toBe("PENDING_APPROVAL");
    const afterStep2 = await transitionJobStatus(financeApprover, submitted.id, { action: "APPROVE", version: afterStep1.version });
    expect(afterStep2.status).toBe("OPEN");

    await prisma.jobApproval.deleteMany({ where: { jobId: submitted.id } });
    await prisma.job.delete({ where: { id: submitted.id } });
  });

  it("two concurrent decisions racing for the same step: exactly one succeeds, the other gets ConflictError", async () => {
    await configureTwoStepChain();
    const submitted = await submitJob();

    const results = await Promise.allSettled([
      transitionJobStatus(hiringManager, submitted.id, { action: "APPROVE", version: submitted.version }),
      transitionJobStatus(hiringManager, submitted.id, { action: "APPROVE", version: submitted.version }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    // Step 1 was decided exactly once — not double-applied.
    const step1 = await prisma.jobApproval.findFirstOrThrow({ where: { jobId: submitted.id, stepOrder: 1 } });
    expect(step1.status).toBe("APPROVED");
    const step2 = await prisma.jobApproval.findFirstOrThrow({ where: { jobId: submitted.id, stepOrder: 2 } });
    expect(step2.status).toBe("PENDING");

    await prisma.jobApproval.deleteMany({ where: { jobId: submitted.id } });
    await prisma.job.delete({ where: { id: submitted.id } });
  });
});

describe("JobService — Recruiting Manager TEAM scope", () => {
  let managerRoleId: string;
  let reporteeRoleId: string;
  let manager: SessionContext;
  let directReport: SessionContext;
  let unrelatedRecruiter: SessionContext;
  let departmentId: string;
  let locationId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const managerRole = await prisma.role.create({
      data: {
        name: "Test Recruiting Manager",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "READ", scope: "TEAM" },
              { resource: "JOB", action: "UPDATE", scope: "TEAM" },
              { resource: "JOB", action: "APPROVE", scope: "TEAM" },
            ],
          },
        },
      },
    });
    managerRoleId = managerRole.id;

    const reporteeRole = await prisma.role.create({
      data: {
        name: "Test Reportee Recruiter",
        rolePermissions: {
          createMany: { data: [{ resource: "JOB", action: "CREATE", scope: "ALL" }] },
        },
      },
    });
    reporteeRoleId = reporteeRole.id;

    const managerUser = await prisma.user.create({
      data: { name: "Team Manager", email: "team-manager@test.local", passwordHash },
    });
    const reporteeUser = await prisma.user.create({
      data: {
        name: "Team Reportee",
        email: "team-reportee@test.local",
        passwordHash,
        managerId: managerUser.id,
      },
    });
    const unrelatedUser = await prisma.user.create({
      data: { name: "Unrelated Recruiter", email: "unrelated@test.local", passwordHash },
    });

    await prisma.userRole.createMany({
      data: [
        { userId: managerUser.id, roleId: managerRoleId },
        { userId: reporteeUser.id, roleId: reporteeRoleId },
        { userId: unrelatedUser.id, roleId: reporteeRoleId },
      ],
    });

    manager = contextFor({ ...managerUser, roles: [{ id: managerRoleId, name: "Test Recruiting Manager", isSuperAdmin: false }] });
    directReport = contextFor({ ...reporteeUser, roles: [{ id: reporteeRoleId, name: "Test Reportee Recruiter", isSuperAdmin: false }] });
    unrelatedRecruiter = contextFor({ ...unrelatedUser, roles: [{ id: reporteeRoleId, name: "Test Reportee Recruiter", isSuperAdmin: false }] });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;
  });

  afterAll(async () => {
    await prisma.jobStatusChange.deleteMany({});
    await prisma.jobRecruiterAssignment.deleteMany({});
    await prisma.job.deleteMany({
      where: { primaryRecruiterId: { in: [directReport.userId, unrelatedRecruiter.userId] } },
    });
    await prisma.controlledListValue.deleteMany({
      where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } },
    });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [managerRoleId, reporteeRoleId] } } });
    await prisma.user.deleteMany({
      where: { email: { in: ["team-manager@test.local", "team-reportee@test.local", "unrelated@test.local"] } },
    });
    await prisma.role.deleteMany({ where: { id: { in: [managerRoleId, reporteeRoleId] } } });
  });

  it("lets a manager read and update their direct report's job via TEAM scope", async () => {
    const job = await createJob(directReport, {
      title: "Team job",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [directReport.userId],
      primaryRecruiterUserId: directReport.userId,
    } as JobCreateInput);

    const viaManager = await getJobById(manager, job.id);
    expect(viaManager.id).toBe(job.id);

    const updated = await updateJob(manager, job.id, { version: 0, title: "Updated by manager" });
    expect(updated.title).toBe("Updated by manager");
  });

  it("blocks the same manager from an unrelated recruiter's job", async () => {
    const job = await createJob(unrelatedRecruiter, {
      title: "Not on the team",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [unrelatedRecruiter.userId],
      primaryRecruiterUserId: unrelatedRecruiter.userId,
    } as JobCreateInput);

    await expect(getJobById(manager, job.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("scopes listJobs to only the manager's team", async () => {
    const { jobs } = await listJobs(manager, { page: 1, pageSize: 50 });
    expect(jobs.every((job) => job.primaryRecruiterId === directReport.userId)).toBe(true);
  });
});

describe("JobService — required custom fields", () => {
  let recruiterRoleId: string;
  let recruiter: SessionContext;
  let departmentId: string;
  let locationId: string;
  let customFieldId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const role = await prisma.role.create({
      data: {
        name: "Test CF Recruiter",
        rolePermissions: { createMany: { data: [{ resource: "JOB", action: "CREATE", scope: "ALL" }] } },
      },
    });
    recruiterRoleId = role.id;

    const user = await prisma.user.create({
      data: { name: "CF Recruiter", email: "cf-recruiter@test.local", passwordHash },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: recruiterRoleId } });
    recruiter = contextFor({ ...user, roles: [{ id: recruiterRoleId, name: "Test CF Recruiter", isSuperAdmin: false }] });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const customField = await prisma.customFieldDefinition.create({
      data: {
        entityType: "JOB",
        key: "clearance_level",
        label: "Clearance Level",
        fieldType: "TEXT",
        isRequired: true,
        isActive: true,
      },
    });
    customFieldId = customField.id;
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { primaryRecruiterId: recruiter.userId } });
    await prisma.customFieldDefinition.delete({ where: { id: customFieldId } });
    await prisma.controlledListValue.deleteMany({
      where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } },
    });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: recruiterRoleId } });
    await prisma.user.deleteMany({ where: { email: "cf-recruiter@test.local" } });
    await prisma.role.delete({ where: { id: recruiterRoleId } });
  });

  it("rejects creating a Job when a required custom field is missing", async () => {
    await expect(
      createJob(recruiter, {
        title: "Missing required custom field",
        departmentId,
        locationId,
        employmentType: "FULL_TIME",
        priority: "LOW",
        positionsCount: 1,
        mustHaveCriteria: [],
        goodToHaveCriteria: [],
        recruiterUserIds: [recruiter.userId],
        primaryRecruiterUserId: recruiter.userId,
      } as JobCreateInput),
    ).rejects.toThrow();
  });

  it("accepts creation once the required custom field is supplied", async () => {
    const job = await createJob(recruiter, {
      title: "Has required custom field",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "LOW",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
      customFields: { clearance_level: "Secret" },
    } as JobCreateInput);

    expect(job.customFields).toMatchObject({ clearance_level: "Secret" });
  });
});

// File-level teardown: disconnects once, after every describe block above has
// finished — not inside any single describe's afterAll, since three of them
// share this one Prisma client sequentially within this file.
afterAll(async () => {
  await prisma.$disconnect();
});
