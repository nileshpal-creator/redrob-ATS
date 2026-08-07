import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { getPipelineStages, replacePipelineStages } from "@/lib/services/pipeline-stages";
import { createApplication } from "@/lib/services/applications";
import { createCandidate } from "@/lib/services/candidates";
import { createJob } from "@/lib/services/jobs";
import type { JobCreateInput } from "@/lib/validations/job";
import type { CandidateCreateInput } from "@/lib/validations/candidate";

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

describe("PipelineStageService", () => {
  let recruiterRoleId: string;
  let readOnlyRoleId: string;
  let recruiter: SessionContext;
  let readOnlyUser: SessionContext;
  let departmentId: string;
  let locationId: string;
  let jobId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test Stage Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "JOB", action: "UPDATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const readOnlyRole = await prisma.role.create({
      data: {
        name: "Test Stage Read Only",
        rolePermissions: { createMany: { data: [{ resource: "JOB", action: "READ", scope: "ALL" }] } },
      },
    });
    readOnlyRoleId = readOnlyRole.id;

    const [recruiterUser, readOnlyUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "Stage Recruiter", email: "stage-recruiter@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Stage Read Only", email: "stage-readonly@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterUser.id, roleId: recruiterRoleId },
        { userId: readOnlyUserRow.id, roleId: readOnlyRoleId },
      ],
    });

    recruiter = contextFor({ ...recruiterUser, roles: [{ id: recruiterRoleId, name: "Test Stage Recruiter", isSuperAdmin: false }] });
    readOnlyUser = contextFor({
      ...readOnlyUserRow,
      roles: [{ id: readOnlyRoleId, name: "Test Stage Read Only", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const job = await createJob(recruiter, {
      title: "Stage Test Job",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    } as JobCreateInput);
    jobId = job.id;
  });

  afterAll(async () => {
    await prisma.application.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [recruiterRoleId, readOnlyRoleId] } } });
    await prisma.user.deleteMany({ where: { email: { in: ["stage-recruiter@test.local", "stage-readonly@test.local"] } } });
    await prisma.role.deleteMany({ where: { id: { in: [recruiterRoleId, readOnlyRoleId] } } });
  });

  it("returns the default four stages in order", async () => {
    const stages = await getPipelineStages(recruiter, jobId);
    expect(stages.map((stage) => stage.name)).toEqual(["Applied", "Screening", "Interview", "Offer"]);
  });

  it("denies replacement for a role with JOB:READ but no JOB:UPDATE", async () => {
    await expect(
      replacePipelineStages(readOnlyUser, jobId, { stages: [{ name: "Applied" }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("renames an existing stage, deactivates an omitted one, and creates a new one — never deleting", async () => {
    const before = await getPipelineStages(recruiter, jobId);
    const applied = before.find((stage) => stage.name === "Applied")!;
    const offer = before.find((stage) => stage.name === "Offer")!;
    const beforeCount = before.length;

    const after = await replacePipelineStages(recruiter, jobId, {
      stages: [
        { id: applied.id, name: "Application Received" },
        { name: "Final Review" },
        // "Screening", "Interview", and "Offer" all omitted.
      ],
    });

    // getPipelineStages/replacePipelineStages return the full admin-config
    // view — active and inactive stages alike — not just what was submitted.
    expect(after).toHaveLength(beforeCount + 1); // +1 new stage, nothing deleted

    const renamed = after.find((stage) => stage.id === applied.id)!;
    expect(renamed.name).toBe("Application Received");
    expect(renamed.isActive).toBe(true);

    const newStage = after.find((stage) => stage.name === "Final Review")!;
    expect(newStage.isActive).toBe(true);

    const offerRow = after.find((stage) => stage.id === offer.id)!;
    expect(offerRow.isActive).toBe(false);

    const screeningRow = after.find((stage) => stage.name === "Screening")!;
    expect(screeningRow.isActive).toBe(false);
  });

  it("reactivates a previously deactivated stage by resubmitting its id", async () => {
    const current = await getPipelineStages(recruiter, jobId);
    const inactive = current.find((stage) => !stage.isActive)!;
    expect(inactive).toBeDefined();

    // getPipelineStages already returns every stage, active or not — simply
    // resubmitting the full current list (ids included) reactivates every
    // one of them, since replacePipelineStages sets isActive: true for any
    // id it's asked to keep.
    const after = await replacePipelineStages(recruiter, jobId, {
      stages: current.map((stage) => ({ id: stage.id, name: stage.name })),
    });

    const reactivated = after.find((stage) => stage.id === inactive.id);
    expect(reactivated?.isActive).toBe(true);
  });

  // Both of the following regression tests use a dedicated job rather than
  // the shared `jobId` fixture — each intentionally leaves the pipeline in
  // an unusual state (swapped names, a duplicate name across an active and
  // an inactive row) that would otherwise leak into and break later tests
  // in this file that assume a clean, uniquely-named, fully-active pipeline.

  it("swaps two stage names in one request without a unique-constraint error", async () => {
    const job = await createJob(recruiter, {
      title: "Swap Names Job",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    } as JobCreateInput);

    const current = await getPipelineStages(recruiter, job.id);
    const [first, second] = current;

    const after = await replacePipelineStages(recruiter, job.id, {
      stages: current.map((stage) => {
        if (stage.id === first.id) return { id: stage.id, name: second.name };
        if (stage.id === second.id) return { id: stage.id, name: first.name };
        return { id: stage.id, name: stage.name };
      }),
    });

    expect(after.find((stage) => stage.id === first.id)?.name).toBe(second.name);
    expect(after.find((stage) => stage.id === second.id)?.name).toBe(first.name);
  });

  it("allows a new active stage to reuse a name just freed by deactivation in the same request", async () => {
    const job = await createJob(recruiter, {
      title: "Reuse Freed Name Job",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
    } as JobCreateInput);

    const current = await getPipelineStages(recruiter, job.id);
    const toDrop = current[0];
    const kept = current.slice(1);

    // Omit toDrop (deactivating it) while introducing a brand-new stage
    // that reuses its exact name — this must not hit the partial unique
    // index, since the old row is no longer active once this call returns.
    const after = await replacePipelineStages(recruiter, job.id, {
      stages: [...kept.map((stage) => ({ id: stage.id, name: stage.name })), { name: toDrop.name }],
    });

    const droppedRow = after.find((stage) => stage.id === toDrop.id)!;
    expect(droppedRow.isActive).toBe(false);

    const newRow = after.find((stage) => stage.name === toDrop.name && stage.id !== toDrop.id)!;
    expect(newRow).toBeDefined();
    expect(newRow.isActive).toBe(true);
  });

  it("keeps an Application's stageId intact when its stage is later deactivated", async () => {
    const stages = await getPipelineStages(recruiter, jobId);
    // Filtered rather than stages[0] — earlier tests in this file may have
    // left an inactive stage sorted first, and creating an application
    // requires an active one.
    const targetStage = stages.find((stage) => stage.isActive)!;

    const candidate = await createCandidate(recruiter, {
      name: "Stage Candidate",
      phone: "+1 555-0950",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
    } as CandidateCreateInput);
    const application = await createApplication(recruiter, {
      candidateId: candidate.id,
      jobId,
      stageId: targetStage.id,
    });

    const remaining = stages.filter((stage) => stage.id !== targetStage.id);
    await replacePipelineStages(recruiter, jobId, {
      stages: remaining.map((stage) => ({ id: stage.id, name: stage.name })),
    });

    const stageRow = await prisma.pipelineStage.findUniqueOrThrow({ where: { id: targetStage.id } });
    expect(stageRow.isActive).toBe(false);

    const applicationRow = await prisma.application.findUniqueOrThrow({ where: { id: application.id } });
    expect(applicationRow.stageId).toBe(targetStage.id); // untouched — the FK is never nulled or reassigned

    await prisma.application.delete({ where: { id: application.id } });
    await prisma.candidate.delete({ where: { id: candidate.id } });
  });
});
