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
      salaryVisible: false,
      recruiterUserIds: [],
      primaryRecruiterUserId: "",
      hiringManagerUserId: "",
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

    const hiringManagerRole = await prisma.role.create({
      data: {
        name: "Test Hiring Manager",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "JOB", action: "APPROVE", scope: "OWN" },
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
    await prisma.$disconnect();
  });

  it("creates a job with a human-readable code and default counters", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
      hiringManagerUserId: hiringManager.userId,
    });

    expect(job.code).toMatch(/^REQ-\d{6}$/);
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
        hiringManagerUserId: hiringManager.userId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets the primary recruiter (OWN scope) update their job, but not a peer recruiter", async () => {
    const job = await createJob(recruiter, {
      ...baseInput(),
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
      hiringManagerUserId: hiringManager.userId,
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
      hiringManagerUserId: hiringManager.userId,
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
      hiringManagerUserId: hiringManager.userId,
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
      hiringManagerUserId: hiringManager.userId,
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
      hiringManagerUserId: hiringManager.userId,
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
      hiringManagerUserId: hiringManager.userId,
    });
    await createJob(otherRecruiter, {
      ...baseInput(),
      title: "Not mine",
      recruiterUserIds: [otherRecruiter.userId],
      primaryRecruiterUserId: otherRecruiter.userId,
      hiringManagerUserId: hiringManager.userId,
    });

    const { jobs } = await listJobs(recruiter, { page: 1, pageSize: 25 });
    const ids = jobs.map((job) => job.id);
    expect(ids).toContain(mine.id);
    expect(jobs.every((job) => job.primaryRecruiterId === recruiter.userId || job.hiringManagerId === recruiter.userId)).toBe(
      true,
    );
  });

  it("denies listJobs entirely for a role with no JOB:READ grant", async () => {
    await expect(listJobs(noAccessUser, { page: 1, pageSize: 25 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
