import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, ValidationError } from "@/lib/errors";
import {
  bulkEmailApplications,
  bulkTransitionApplications,
  createApplication,
  findDuplicateApplications,
  getApplication,
  listApplications,
  transitionApplication,
  updateApplication,
} from "@/lib/services/applications";
import { deleteCandidate, createCandidate, getCandidateTimeline } from "@/lib/services/candidates";
import { createJob } from "@/lib/services/jobs";
import type { CandidateCreateInput } from "@/lib/validations/candidate";
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

describe("ApplicationService", () => {
  let recruiterRoleId: string;
  let hiringManagerRoleId: string;
  let noAccessRoleId: string;

  let recruiter: SessionContext;
  let otherRecruiter: SessionContext;
  let hiringManager: SessionContext;
  let noAccessUser: SessionContext;

  let departmentId: string;
  let locationId: string;
  let rejectionReasonId: string;
  let wrongListReasonId: string;

  let jobId: string;
  let jobPrimaryRecruiterId: string;
  let appliedStageId: string;
  let screeningStageId: string;
  let interviewStageId: string;
  let candidateId: string;

  const jobInput = (overrides: Partial<JobCreateInput> = {}): JobCreateInput =>
    ({
      title: "Backend Engineer",
      departmentId,
      locationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiter.userId],
      primaryRecruiterUserId: recruiter.userId,
      ...overrides,
    }) as JobCreateInput;

  const candidateInput = (overrides: Partial<CandidateCreateInput> = {}): CandidateCreateInput =>
    ({
      name: "Jane Applicant",
      phone: "+1 555-0900",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
      ...overrides,
    }) as CandidateCreateInput;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test App Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "JOB", action: "UPDATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "DELETE", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
              { resource: "APPLICATION", action: "READ", scope: "OWN" },
              { resource: "APPLICATION", action: "UPDATE", scope: "OWN" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const hiringManagerRole = await prisma.role.create({
      data: {
        name: "Test App Hiring Manager",
        rolePermissions: {
          createMany: { data: [{ resource: "APPLICATION", action: "READ", scope: "ALL" }] },
        },
      },
    });
    hiringManagerRoleId = hiringManagerRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test App No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [recruiterUser, otherRecruiterUser, hiringManagerUser, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "App Recruiter", email: "app-recruiter@test.local", passwordHash } }),
      prisma.user.create({
        data: { name: "App Other Recruiter", email: "app-other-recruiter@test.local", passwordHash },
      }),
      prisma.user.create({ data: { name: "App Hiring Manager", email: "app-hm@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "App No Access", email: "app-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterUser.id, roleId: recruiterRoleId },
        { userId: otherRecruiterUser.id, roleId: recruiterRoleId },
        { userId: hiringManagerUser.id, roleId: hiringManagerRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    recruiter = contextFor({ ...recruiterUser, roles: [{ id: recruiterRoleId, name: "Test App Recruiter", isSuperAdmin: false }] });
    otherRecruiter = contextFor({
      ...otherRecruiterUser,
      roles: [{ id: recruiterRoleId, name: "Test App Recruiter", isSuperAdmin: false }],
    });
    hiringManager = contextFor({
      ...hiringManagerUser,
      roles: [{ id: hiringManagerRoleId, name: "Test App Hiring Manager", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test App No Access", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const rejectionList = await prisma.controlledList.create({
      data: {
        key: "REJECTION_REASON",
        label: "Rejection Reasons",
        values: { create: { value: "skills", label: "Skills mismatch" } },
      },
    });
    rejectionReasonId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: rejectionList.id } })).id;
    // A value from the wrong list — proves the reason is checked against
    // REJECTION_REASON specifically, not just "any active ControlledListValue".
    wrongListReasonId = departmentId;

    const job = await createJob(recruiter, jobInput());
    jobId = job.id;
    jobPrimaryRecruiterId = job.primaryRecruiterId;

    const stages = await prisma.pipelineStage.findMany({ where: { jobId }, orderBy: { sortOrder: "asc" } });
    [appliedStageId, screeningStageId, interviewStageId] = stages.map((stage) => stage.id);

    const candidate = await createCandidate(recruiter, candidateInput({ email: "jane@test.local" }));
    candidateId = candidate.id;
  });

  afterAll(async () => {
    await prisma.applicationEmailLog.deleteMany({});
    await prisma.applicationEvent.deleteMany({});
    await prisma.application.deleteMany({});
    await prisma.pipelineStage.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.controlledListValue.deleteMany({
      where: { list: { key: { in: ["DEPARTMENT", "LOCATION", "REJECTION_REASON"] } } },
    });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION", "REJECTION_REASON"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [recruiterRoleId, hiringManagerRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({
      where: {
        email: { in: ["app-recruiter@test.local", "app-other-recruiter@test.local", "app-hm@test.local", "app-noaccess@test.local"] },
      },
    });
    await prisma.role.deleteMany({ where: { id: { in: [recruiterRoleId, hiringManagerRoleId, noAccessRoleId] } } });
  });

  it("createJob auto-seeds the default four-stage pipeline in order", async () => {
    const stages = await prisma.pipelineStage.findMany({ where: { jobId }, orderBy: { sortOrder: "asc" } });
    expect(stages.map((stage) => stage.name)).toEqual(["Applied", "Screening", "Interview", "Offer"]);
    expect(stages.every((stage) => stage.isActive)).toBe(true);
  });

  it("creates an application defaulting stage and owner", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId });

    expect(application.stageId).toBe(appliedStageId);
    expect(application.ownerId).toBe(jobPrimaryRecruiterId);
    expect(application.outcome).toBe("ACTIVE");
    expect(application.version).toBe(0);
    expect(application.priorApplications).toEqual([]);

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("creates an application with an explicit stage and owner", async () => {
    const application = await createApplication(recruiter, {
      candidateId,
      jobId,
      stageId: screeningStageId,
      ownerId: otherRecruiter.userId,
    });

    expect(application.stageId).toBe(screeningStageId);
    expect(application.ownerId).toBe(otherRecruiter.userId);

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("rejects creation from a user without APPLICATION:CREATE", async () => {
    await expect(createApplication(noAccessUser, { candidateId, jobId })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects an unknown candidate or job", async () => {
    await expect(createApplication(recruiter, { candidateId: "nope", jobId })).rejects.toBeInstanceOf(ValidationError);
    await expect(createApplication(recruiter, { candidateId, jobId: "nope" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a stageId that belongs to a different job", async () => {
    const otherJob = await createJob(recruiter, jobInput({ title: "Other job" }));
    const otherStage = await prisma.pipelineStage.findFirstOrThrow({ where: { jobId: otherJob.id } });

    await expect(
      createApplication(recruiter, { candidateId, jobId, stageId: otherStage.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("warns on but never blocks re-adding a candidate to the same job's pipeline", async () => {
    const first = await createApplication(recruiter, { candidateId, jobId });
    const second = await createApplication(recruiter, { candidateId, jobId });

    expect(second.priorApplications.map((application) => application.id)).toContain(first.id);
    expect(await prisma.application.count({ where: { candidateId, jobId } })).toBe(2);

    const { priorApplications } = await findDuplicateApplications(recruiter, { candidateId, jobId });
    expect(priorApplications.map((application) => application.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );

    await prisma.application.deleteMany({ where: { id: { in: [first.id, second.id] } } });
  });

  it("enforces OWN-scope ownership on get/update and denies a non-owner", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });

    const fetched = await getApplication(recruiter, application.id);
    expect(fetched.id).toBe(application.id);

    await expect(getApplication(otherRecruiter, application.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateApplication(otherRecruiter, application.id, { version: application.version }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("reassigns the owner and rejects a stale version with ConflictError", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });

    const reassigned = await updateApplication(recruiter, application.id, {
      version: application.version,
      ownerId: otherRecruiter.userId,
    });
    expect(reassigned.ownerId).toBe(otherRecruiter.userId);
    expect(reassigned.version).toBe(1);

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("rejects a stale version on update with ConflictError", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });
    await updateApplication(recruiter, application.id, { version: application.version, customFields: {} });

    // application.version is now stale — the update above already advanced it to 1.
    await expect(
      updateApplication(recruiter, application.id, { version: application.version, customFields: {} }),
    ).rejects.toBeInstanceOf(ConflictError);

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("moves stage, logs an ApplicationEvent, and updates stageEnteredAt", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });

    const moved = await transitionApplication(recruiter, application.id, {
      action: "STAGE_MOVE",
      version: application.version,
      toStageId: interviewStageId,
    });
    expect(moved.stageId).toBe(interviewStageId);
    expect(moved.version).toBe(1);
    expect(moved.stageEnteredAt.getTime()).toBeGreaterThanOrEqual(application.stageEnteredAt.getTime());

    const events = await prisma.applicationEvent.findMany({ where: { applicationId: application.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "STAGE_CHANGE",
      fromStageId: appliedStageId,
      toStageId: interviewStageId,
    });

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("rejects a STAGE_MOVE to a stage outside the application's job", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });
    const otherJob = await createJob(recruiter, jobInput({ title: "Yet another job" }));
    const otherStage = await prisma.pipelineStage.findFirstOrThrow({ where: { jobId: otherJob.id } });

    await expect(
      transitionApplication(recruiter, application.id, {
        action: "STAGE_MOVE",
        version: application.version,
        toStageId: otherStage.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("rejects with a reason and freezes the stage; outcome is terminal", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });

    const rejected = await transitionApplication(recruiter, application.id, {
      action: "REJECT",
      version: application.version,
      reasonId: rejectionReasonId,
    });
    expect(rejected.outcome).toBe("REJECTED");
    expect(rejected.outcomeReasonId).toBe(rejectionReasonId);
    expect(rejected.stageId).toBe(appliedStageId); // frozen, never moved
    expect(rejected.outcomeAt).not.toBeNull();

    // Terminal: no further transition of any kind is accepted.
    await expect(
      transitionApplication(recruiter, application.id, {
        action: "STAGE_MOVE",
        version: rejected.version,
        toStageId: interviewStageId,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      transitionApplication(recruiter, application.id, {
        action: "WITHDRAW",
        version: rejected.version,
        reasonId: rejectionReasonId,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const events = await prisma.applicationEvent.findMany({ where: { applicationId: application.id } });
    expect(events.map((event) => event.type)).toEqual(["REJECTED"]);

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("withdraws with a reason", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });

    const withdrawn = await transitionApplication(recruiter, application.id, {
      action: "WITHDRAW",
      version: application.version,
      reasonId: rejectionReasonId,
    });
    expect(withdrawn.outcome).toBe("WITHDRAWN");

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("rejects a reason id that belongs to the wrong controlled list", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });

    await expect(
      transitionApplication(recruiter, application.id, {
        action: "REJECT",
        version: application.version,
        reasonId: wrongListReasonId,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("rejects a stale version on transition with ConflictError", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });
    await transitionApplication(recruiter, application.id, {
      action: "STAGE_MOVE",
      version: application.version,
      toStageId: screeningStageId,
    });

    await expect(
      transitionApplication(recruiter, application.id, {
        action: "STAGE_MOVE",
        version: application.version, // stale — already advanced to 1
        toStageId: interviewStageId,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("bulk-transitions with partial success — one target succeeds, one fails on a stale version", async () => {
    const a = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });
    const b = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });
    await transitionApplication(recruiter, b.id, { action: "STAGE_MOVE", version: b.version, toStageId: screeningStageId });

    const result = await bulkTransitionApplications(recruiter, {
      action: "STAGE_MOVE",
      applications: [
        { id: a.id, version: a.version },
        { id: b.id, version: b.version }, // stale — b already moved above
      ],
      toStageId: interviewStageId,
    });

    expect(result.succeeded.map((application) => application.id)).toEqual([a.id]);
    expect(result.failed).toEqual([{ id: b.id, reason: expect.stringContaining("changed by someone else") }]);

    await prisma.application.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });

  it("bulk-rejects multiple applications with a shared reason", async () => {
    const a = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });
    const b = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });

    const result = await bulkTransitionApplications(recruiter, {
      action: "REJECT",
      applications: [
        { id: a.id, version: a.version },
        { id: b.id, version: b.version },
      ],
      reasonId: rejectionReasonId,
    });

    expect(result.succeeded).toHaveLength(2);
    expect(result.succeeded.every((application) => application.outcome === "REJECTED")).toBe(true);

    await prisma.application.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });

  it("bulk-emails: renders the template, sends, logs a SENT row, and skips a candidate with no email", async () => {
    const template = await prisma.communicationTemplate.create({
      data: {
        name: `Application Update ${Date.now()}`,
        subject: "Update on your application to {{job.title}}",
        body: "Hi {{candidate.name}}, thanks for applying.",
        createdById: recruiter.userId,
      },
    });
    const noEmailCandidate = await createCandidate(
      recruiter,
      candidateInput({ phone: "+1 555-0901", name: "No Email Candidate", email: undefined }),
    );
    const withEmail = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });
    const withoutEmail = await createApplication(recruiter, {
      candidateId: noEmailCandidate.id,
      jobId,
      ownerId: recruiter.userId,
    });

    const result = await bulkEmailApplications(recruiter, {
      applicationIds: [withEmail.id, withoutEmail.id],
      templateId: template.id,
    });

    expect(result.succeeded).toEqual([{ applicationId: withEmail.id, toEmail: "jane@test.local", status: "SENT" }]);
    expect(result.failed).toEqual([{ id: withoutEmail.id, reason: expect.stringContaining("no email") }]);

    const log = await prisma.applicationEmailLog.findFirstOrThrow({ where: { applicationId: withEmail.id } });
    expect(log.status).toBe("SENT");
    expect(log.templateId).toBe(template.id);
    expect(log.subject).toBe("Update on your application to Backend Engineer");
    expect(log.body).toBe("Hi Jane Applicant, thanks for applying.");
    expect(log.sentAt).not.toBeNull();

    await prisma.applicationEmailLog.deleteMany({ where: { applicationId: { in: [withEmail.id, withoutEmail.id] } } });
    await prisma.application.deleteMany({ where: { id: { in: [withEmail.id, withoutEmail.id] } } });
    await prisma.candidate.delete({ where: { id: noEmailCandidate.id } });
    await prisma.communicationTemplate.delete({ where: { id: template.id } });
  });

  it("bulk-emails: rejects the whole call for an unknown templateId — a shared precondition, not a per-item failure", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });

    await expect(
      bulkEmailApplications(recruiter, { applicationIds: [application.id], templateId: "nope" }),
    ).rejects.toBeInstanceOf(ValidationError);

    const logs = await prisma.applicationEmailLog.findMany({ where: { applicationId: application.id } });
    expect(logs).toHaveLength(0);

    await prisma.application.delete({ where: { id: application.id } });
  });

  it("bulk-emails: rejects the whole call for an inactive template", async () => {
    const template = await prisma.communicationTemplate.create({
      data: {
        name: `Inactive Bulk Email ${Date.now()}`,
        subject: "x",
        body: "x",
        isActive: false,
        createdById: recruiter.userId,
      },
    });
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });

    await expect(
      bulkEmailApplications(recruiter, { applicationIds: [application.id], templateId: template.id }),
    ).rejects.toBeInstanceOf(ValidationError);

    await prisma.application.delete({ where: { id: application.id } });
    await prisma.communicationTemplate.delete({ where: { id: template.id } });
  });

  it("bulk-emails: surfaces an email_sent item on the candidate timeline", async () => {
    const template = await prisma.communicationTemplate.create({
      data: {
        name: `Timeline Email Template ${Date.now()}`,
        subject: "Update on {{job.title}}",
        body: "Hi {{candidate.name}}",
        createdById: recruiter.userId,
      },
    });
    const candidate = await createCandidate(
      recruiter,
      candidateInput({ phone: "+1 555-0902", name: "Timeline Email Candidate", email: "timeline-email@test.local" }),
    );
    const application = await createApplication(recruiter, { candidateId: candidate.id, jobId, ownerId: recruiter.userId });

    await bulkEmailApplications(recruiter, { applicationIds: [application.id], templateId: template.id });

    const timeline = await getCandidateTimeline(recruiter, candidate.id);
    const emailItem = timeline.items.find((item) => item.type === "email_sent");
    expect(emailItem).toBeDefined();
    if (emailItem?.type === "email_sent") {
      expect(emailItem.templateName).toBe(template.name);
      expect(emailItem.subject).toBe("Update on Backend Engineer");
    }

    await prisma.applicationEmailLog.deleteMany({ where: { applicationId: application.id } });
    await prisma.application.delete({ where: { id: application.id } });
    await prisma.candidate.delete({ where: { id: candidate.id } });
    await prisma.communicationTemplate.delete({ where: { id: template.id } });
  });

  it("scopes listApplications to OWN records", async () => {
    const mine = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });
    const theirs = await createApplication(recruiter, { candidateId, jobId, ownerId: otherRecruiter.userId });

    const { applications } = await listApplications(recruiter, { page: 1, pageSize: 25 });
    const ids = applications.map((application) => application.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);

    await prisma.application.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
  });

  it("denies listApplications entirely for a role with no APPLICATION:READ grant", async () => {
    await expect(listApplications(noAccessUser, { page: 1, pageSize: 25 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("total reflects the full matching count independent of pageSize — the Job Pipeline page's fix for its 100-item cap relies on re-querying with pageSize: total", async () => {
    const created = await Promise.all(
      Array.from({ length: 5 }, () => createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId })),
    );

    const firstPage = await listApplications(recruiter, { jobId, page: 1, pageSize: 2 });
    expect(firstPage.applications).toHaveLength(2);
    expect(firstPage.total).toBeGreaterThanOrEqual(5);

    const fullPage = await listApplications(recruiter, { jobId, page: 1, pageSize: firstPage.total });
    expect(fullPage.applications).toHaveLength(firstPage.total);
    const fullIds = fullPage.applications.map((application) => application.id);
    for (const application of created) {
      expect(fullIds).toContain(application.id);
    }

    await prisma.application.deleteMany({ where: { id: { in: created.map((application) => application.id) } } });
  });

  it("lets a broad READ:ALL role (Hiring Manager) see applications it doesn't own", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });
    const viaHiringManager = await getApplication(hiringManager, application.id);
    expect(viaHiringManager.id).toBe(application.id);
    await prisma.application.delete({ where: { id: application.id } });
  });

  it("records an AuditLog entry with the correct actor for create/transition/bulk actions", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });
    const createdLog = await prisma.auditLog.findFirst({ where: { action: "application.created", entityId: application.id } });
    expect(createdLog?.actorId).toBe(recruiter.userId);

    const moved = await transitionApplication(recruiter, application.id, {
      action: "STAGE_MOVE",
      version: application.version,
      toStageId: screeningStageId,
    });
    const stageLog = await prisma.auditLog.findFirst({ where: { action: "application.stage_changed", entityId: application.id } });
    expect(stageLog?.actorId).toBe(recruiter.userId);

    await bulkTransitionApplications(recruiter, {
      action: "REJECT",
      applications: [{ id: application.id, version: moved.version }],
      reasonId: rejectionReasonId,
    });
    const bulkLog = await prisma.auditLog.findFirst({
      where: { action: "application.bulk_transitioned" },
      orderBy: { createdAt: "desc" },
    });
    expect(bulkLog?.actorId).toBe(recruiter.userId);

    await prisma.application.delete({ where: { id: application.id } });
  });

  // --- Cross-module regression: Candidate delete guard (Module 3) ---

  it("blocks deleting a candidate that has applications, and still allows it once they're gone", async () => {
    const application = await createApplication(recruiter, { candidateId, jobId, ownerId: recruiter.userId });

    await expect(deleteCandidate(recruiter, candidateId)).rejects.toBeInstanceOf(ValidationError);

    await prisma.application.delete({ where: { id: application.id } });

    const freshCandidate = await createCandidate(recruiter, candidateInput({ phone: "+1 555-0902" }));
    await expect(deleteCandidate(recruiter, freshCandidate.id)).resolves.toBeUndefined();
  });
});

/**
 * Regression coverage for a real bug report: opening a Job's Pipeline
 * (src/app/(app)/jobs/[id]/pipeline/page.tsx) as a Recruiter threw
 * ForbiddenError from `listApplications`. That page calls `listApplications`
 * with no `ownerId` filter — it needs every application on the job, not
 * just ones the viewing recruiter happens to own/created themselves — which
 * only works if Recruiter's default APPLICATION:READ grant is ALL scope.
 *
 * This mirrors prisma/seed.ts's APPLICATION_ROLE_PERMISSIONS directly
 * (Recruiter: CREATE ALL / READ ALL / UPDATE OWN; Hiring Manager: READ ALL;
 * Recruiting Manager: CREATE ALL / READ TEAM / UPDATE TEAM), the same
 * "hand-copy the seed fixture, so a future edit to seed.ts must be
 * deliberately reflected here too" convention CandidateService's own
 * "role permission matrix" describe block (tests/services/candidates.service.test.ts)
 * already uses — unlike this file's *other* "Test App Recruiter" fixture
 * above, which deliberately narrows APPLICATION:READ to OWN scope to unit
 * test the OWN-scope mechanism in isolation, not to represent the real
 * default grant.
 */
describe("ApplicationService — role permission matrix (mirrors prisma/seed.ts APPLICATION_ROLE_PERMISSIONS)", () => {
  let matrixRecruiterRoleId: string;
  let matrixHiringManagerRoleId: string;
  let matrixRecruitingManagerRoleId: string;

  let recruiterA: SessionContext;
  let recruiterB: SessionContext;
  let matrixHiringManager: SessionContext;
  let matrixRecruitingManager: SessionContext;
  let matrixReportee: SessionContext;

  let matrixDepartmentId: string;
  let matrixLocationId: string;
  let matrixJobId: string;
  let matrixCandidateId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const [recruiterRole, hiringManagerRole, recruitingManagerRole] = await Promise.all([
      prisma.role.create({
        data: {
          name: "Test App Matrix Recruiter",
          rolePermissions: {
            createMany: {
              data: [
                { resource: "JOB", action: "CREATE", scope: "ALL" },
                { resource: "JOB", action: "READ", scope: "ALL" },
                { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
                { resource: "CANDIDATE", action: "READ", scope: "ALL" },
                { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
                { resource: "APPLICATION", action: "READ", scope: "ALL" },
                { resource: "APPLICATION", action: "UPDATE", scope: "OWN" },
              ],
            },
          },
        },
      }),
      prisma.role.create({
        data: {
          name: "Test App Matrix Hiring Manager",
          rolePermissions: { createMany: { data: [{ resource: "APPLICATION", action: "READ", scope: "ALL" }] } },
        },
      }),
      prisma.role.create({
        data: {
          name: "Test App Matrix Recruiting Manager",
          rolePermissions: {
            createMany: {
              data: [
                { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
                { resource: "APPLICATION", action: "READ", scope: "TEAM" },
                { resource: "APPLICATION", action: "UPDATE", scope: "TEAM" },
              ],
            },
          },
        },
      }),
    ]);
    matrixRecruiterRoleId = recruiterRole.id;
    matrixHiringManagerRoleId = hiringManagerRole.id;
    matrixRecruitingManagerRoleId = recruitingManagerRole.id;

    const [recruiterAUser, recruiterBUser, hiringManagerUser, recruitingManagerUser, reporteeUser] =
      await Promise.all([
        prisma.user.create({ data: { name: "Matrix Recruiter A", email: "matrix-app-recruiter-a@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Matrix Recruiter B", email: "matrix-app-recruiter-b@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Matrix App Hiring Manager", email: "matrix-app-hm@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Matrix App Recruiting Manager", email: "matrix-app-rm@test.local", passwordHash } }),
        prisma.user.create({ data: { name: "Matrix App Reportee", email: "matrix-app-reportee@test.local", passwordHash } }),
      ]);

    await prisma.user.update({ where: { id: reporteeUser.id }, data: { managerId: recruitingManagerUser.id } });

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterAUser.id, roleId: matrixRecruiterRoleId },
        { userId: recruiterBUser.id, roleId: matrixRecruiterRoleId },
        { userId: hiringManagerUser.id, roleId: matrixHiringManagerRoleId },
        { userId: recruitingManagerUser.id, roleId: matrixRecruitingManagerRoleId },
        { userId: reporteeUser.id, roleId: matrixRecruiterRoleId },
      ],
    });

    recruiterA = contextFor({
      ...recruiterAUser,
      roles: [{ id: matrixRecruiterRoleId, name: "Test App Matrix Recruiter", isSuperAdmin: false }],
    });
    recruiterB = contextFor({
      ...recruiterBUser,
      roles: [{ id: matrixRecruiterRoleId, name: "Test App Matrix Recruiter", isSuperAdmin: false }],
    });
    matrixHiringManager = contextFor({
      ...hiringManagerUser,
      roles: [{ id: matrixHiringManagerRoleId, name: "Test App Matrix Hiring Manager", isSuperAdmin: false }],
    });
    matrixRecruitingManager = contextFor({
      ...recruitingManagerUser,
      roles: [{ id: matrixRecruitingManagerRoleId, name: "Test App Matrix Recruiting Manager", isSuperAdmin: false }],
    });
    matrixReportee = contextFor({
      ...reporteeUser,
      roles: [{ id: matrixRecruiterRoleId, name: "Test App Matrix Recruiter", isSuperAdmin: false }],
    });

    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    matrixDepartmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;

    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    matrixLocationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    // Recruiter A creates the job and candidate — recruiterB/hiringManager/
    // recruitingManager never touch either, so any access they get to the
    // resulting application comes entirely from their APPLICATION grant.
    const job = await createJob(recruiterA, {
      title: "Pipeline Regression Job",
      departmentId: matrixDepartmentId,
      locationId: matrixLocationId,
      employmentType: "FULL_TIME",
      priority: "MEDIUM",
      positionsCount: 1,
      mustHaveCriteria: [],
      goodToHaveCriteria: [],
      recruiterUserIds: [recruiterAUser.id],
      primaryRecruiterUserId: recruiterAUser.id,
    } as JobCreateInput);
    matrixJobId = job.id;

    const candidate = await createCandidate(recruiterA, {
      name: "Pipeline Regression Candidate",
      phone: "+1 555-8100",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
    } as CandidateCreateInput);
    matrixCandidateId = candidate.id;
  });

  afterAll(async () => {
    await prisma.applicationEvent.deleteMany({ where: { application: { jobId: matrixJobId } } });
    await prisma.application.deleteMany({ where: { jobId: matrixJobId } });
    await prisma.pipelineStage.deleteMany({ where: { jobId: matrixJobId } });
    await prisma.job.deleteMany({ where: { id: matrixJobId } });
    await prisma.candidate.deleteMany({ where: { id: matrixCandidateId } });
    await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    await prisma.userRole.deleteMany({
      where: { roleId: { in: [matrixRecruiterRoleId, matrixHiringManagerRoleId, matrixRecruitingManagerRoleId] } },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            "matrix-app-recruiter-a@test.local",
            "matrix-app-recruiter-b@test.local",
            "matrix-app-hm@test.local",
            "matrix-app-rm@test.local",
            "matrix-app-reportee@test.local",
          ],
        },
      },
    });
    await prisma.role.deleteMany({
      where: { id: { in: [matrixRecruiterRoleId, matrixHiringManagerRoleId, matrixRecruitingManagerRoleId] } },
    });
  });

  it("Recruiter: READ:ALL lets a recruiter view a job's full pipeline, not just applications they own — the exact Job Pipeline scenario", async () => {
    const application = await createApplication(recruiterA, {
      candidateId: matrixCandidateId,
      jobId: matrixJobId,
      ownerId: recruiterA.userId,
    });

    // This is what src/app/(app)/jobs/[id]/pipeline/page.tsx calls: list
    // every application on the job, no ownerId filter. recruiterB owns
    // nothing here — under ALL scope this must still succeed and return it.
    const { applications } = await listApplications(recruiterB, { jobId: matrixJobId, page: 1, pageSize: 25 });
    expect(applications.map((row) => row.id)).toContain(application.id);

    await expect(getApplication(recruiterB, application.id)).resolves.toBeTruthy();
  });

  it("Recruiter: UPDATE:OWN still blocks a non-owner from mutating it", async () => {
    const application = await createApplication(recruiterA, {
      candidateId: matrixCandidateId,
      jobId: matrixJobId,
      ownerId: recruiterA.userId,
    });

    await expect(
      updateApplication(recruiterB, application.id, { version: application.version }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Hiring Manager: READ:ALL can view the pipeline but has no CREATE grant", async () => {
    const application = await createApplication(recruiterA, {
      candidateId: matrixCandidateId,
      jobId: matrixJobId,
      ownerId: recruiterA.userId,
    });

    const { applications } = await listApplications(matrixHiringManager, { jobId: matrixJobId, page: 1, pageSize: 25 });
    expect(applications.map((row) => row.id)).toContain(application.id);

    await expect(
      createApplication(matrixHiringManager, { candidateId: matrixCandidateId, jobId: matrixJobId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Recruiting Manager: READ:TEAM sees a direct report's application but not an unrelated recruiter's", async () => {
    const reporteeApplication = await createApplication(matrixReportee, {
      candidateId: matrixCandidateId,
      jobId: matrixJobId,
      ownerId: matrixReportee.userId,
    });
    const unrelatedApplication = await createApplication(recruiterA, {
      candidateId: matrixCandidateId,
      jobId: matrixJobId,
      ownerId: recruiterA.userId,
    });

    const { applications } = await listApplications(matrixRecruitingManager, {
      jobId: matrixJobId,
      page: 1,
      pageSize: 25,
    });
    const ids = applications.map((row) => row.id);
    expect(ids).toContain(reporteeApplication.id);
    expect(ids).not.toContain(unrelatedApplication.id);

    await expect(getApplication(matrixRecruitingManager, unrelatedApplication.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
