import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { createReferral } from "@/lib/services/referrals";
import { createJob } from "@/lib/services/jobs";
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

describe("ReferralService", () => {
  let referrerRoleId: string;
  let noAccessRoleId: string;

  let referrer: SessionContext;
  let noAccessUser: SessionContext;

  let departmentId: string;
  let locationId: string;
  let referralSourceId: string;
  let jobId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const referrerRole = await prisma.role.create({
      data: {
        name: "Test Referral Referrer",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "UPDATE", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
            ],
          },
        },
      },
    });
    referrerRoleId = referrerRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test Referral No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [referrerUser, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "Referrer", email: "ref-referrer@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Referral No Access", email: "ref-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: referrerUser.id, roleId: referrerRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    referrer = contextFor({ ...referrerUser, roles: [{ id: referrerRoleId, name: "Test Referral Referrer", isSuperAdmin: false }] });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test Referral No Access", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const sourceList = await prisma.controlledList.create({
      data: {
        key: "CANDIDATE_SOURCE",
        label: "Candidate Sources",
        values: { create: { value: "referral", label: "Referral" } },
      },
    });
    referralSourceId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: sourceList.id } })).id;

    const job = await createJob(referrer, {
      title: "Frontend Engineer",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 2,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [referrer.userId],
      primaryRecruiterUserId: referrer.userId,
    } as JobCreateInput);
    jobId = job.id;
  });

  afterAll(async () => {
    await prisma.candidateNote.deleteMany({ where: { candidate: { createdById: referrer.userId } } });
    await prisma.applicationEvent.deleteMany({});
    await prisma.application.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.candidate.deleteMany({ where: { createdById: referrer.userId } });
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION", "CANDIDATE_SOURCE"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION", "CANDIDATE_SOURCE"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [referrerRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({ where: { email: { in: ["ref-referrer@test.local", "ref-noaccess@test.local"] } } });
    await prisma.role.deleteMany({ where: { id: { in: [referrerRoleId, noAccessRoleId] } } });
  });

  it("creates a candidate sourced as Referral and an application for the named job in one step", async () => {
    const application = await createReferral(referrer, {
      jobId,
      name: "Referred Candidate",
      phone: "+1 555-8001",
      email: "referred@example.com",
      note: "Worked with them at a prior company",
    });

    expect(application.jobId).toBe(jobId);

    const candidate = await prisma.candidate.findUniqueOrThrow({ where: { id: application.candidateId } });
    expect(candidate.sourceId).toBe(referralSourceId);
    expect(candidate.name).toBe("Referred Candidate");

    const notes = await prisma.candidateNote.findMany({ where: { candidateId: candidate.id } });
    expect(notes.some((note) => note.body.includes("Worked with them at a prior company"))).toBe(true);

    const audit = await prisma.auditLog.findMany({
      where: { entityType: "APPLICATION", entityId: application.id, action: "candidate.referred" },
    });
    expect(audit).toHaveLength(1);
  });

  it("reuses an existing candidate by phone match rather than creating a duplicate", async () => {
    const first = await createReferral(referrer, { jobId, name: "Repeat Referral", phone: "+1 555-8002" });

    const secondJob = await createJob(referrer, {
      title: "Second Role",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [referrer.userId],
      primaryRecruiterUserId: referrer.userId,
    } as JobCreateInput);

    const second = await createReferral(referrer, { jobId: secondJob.id, name: "Repeat Referral", phone: "+1 555-8002" });

    expect(second.candidateId).toBe(first.candidateId);

    const candidates = await prisma.candidate.findMany({ where: { phone: "+1 555-8002" } });
    expect(candidates).toHaveLength(1);
  });

  it("throws NotFoundError for an unknown job id", async () => {
    await expect(createReferral(referrer, { jobId: "nope", name: "X", phone: "+1 555-8003" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("blocks a user with no APPLICATION:CREATE / CANDIDATE:CREATE grant", async () => {
    await expect(
      createReferral(noAccessUser, { jobId, name: "X", phone: "+1 555-8004" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when no active Referral source value is configured", async () => {
    await prisma.controlledListValue.updateMany({ where: { id: referralSourceId }, data: { isActive: false } });

    await expect(createReferral(referrer, { jobId, name: "X", phone: "+1 555-8005" })).rejects.toBeInstanceOf(
      ValidationError,
    );

    await prisma.controlledListValue.updateMany({ where: { id: referralSourceId }, data: { isActive: true } });
  });
});
