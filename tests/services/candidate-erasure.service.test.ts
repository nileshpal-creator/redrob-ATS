import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  decideCandidateErasureRequest,
  listCandidateErasureRequests,
  listMyErasureRequestsForCandidate,
  requestCandidateErasure,
  runDueRetentionSweeps,
} from "@/lib/services/candidate-erasure";
import { createJob } from "@/lib/services/jobs";
import { createApplication } from "@/lib/services/applications";
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

describe("CandidateErasureService", () => {
  let deleteOnlyRoleId: string;
  let decideRoleId: string;
  let noAccessRoleId: string;

  let deleteOnlyUser: SessionContext; // CANDIDATE:DELETE (ALL) but no APPROVE
  let decideUser: SessionContext; // CANDIDATE:DELETE + APPROVE, both ALL scope
  let noAccessUser: SessionContext;

  // Organization is a genuine DB singleton shared across every test file in
  // this suite (see approvals.service.test.ts's own comment on this same
  // hazard) — capture whether it pre-existed so afterAll restores rather
  // than deletes a row another file's fixtures also depend on.
  let organizationPreExisted: boolean;
  let organizationId: string;

  async function freshCandidate(overrides: Record<string, unknown> = {}) {
    return prisma.candidate.create({
      data: {
        name: "Erasure Test Candidate",
        phone: `+1 555-${Math.floor(Math.random() * 900000 + 100000)}`,
        consentGivenAt: new Date(),
        createdById: decideUser.userId,
        ...overrides,
      },
    });
  }

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const deleteOnlyRole = await prisma.role.create({
      data: {
        name: "Test Erasure Delete Only",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "DELETE", scope: "ALL" },
            ],
          },
        },
      },
    });
    deleteOnlyRoleId = deleteOnlyRole.id;

    const decideRole = await prisma.role.create({
      data: {
        name: "Test Erasure Decide",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "DELETE", scope: "ALL" },
              { resource: "CANDIDATE", action: "APPROVE", scope: "ALL" },
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
            ],
          },
        },
      },
    });
    decideRoleId = decideRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test Erasure No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [deleteOnlyUserRow, decideUserRow, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "Erasure DeleteOnly", email: "erasure-deleteonly@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Erasure Decide", email: "erasure-decide@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Erasure NoAccess", email: "erasure-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: deleteOnlyUserRow.id, roleId: deleteOnlyRoleId },
        { userId: decideUserRow.id, roleId: decideRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    deleteOnlyUser = contextFor({ ...deleteOnlyUserRow, roles: [{ id: deleteOnlyRoleId, name: "Test Erasure Delete Only", isSuperAdmin: false }] });
    decideUser = contextFor({ ...decideUserRow, roles: [{ id: decideRoleId, name: "Test Erasure Decide", isSuperAdmin: false }] });
    noAccessUser = contextFor({ ...noAccessUserRow, roles: [{ id: noAccessRoleId, name: "Test Erasure No Access", isSuperAdmin: false }] });

    const existingOrg = await prisma.organization.findFirst();
    organizationPreExisted = existingOrg !== null;
    organizationId = existingOrg
      ? existingOrg.id
      : (await prisma.organization.create({ data: { name: "Test Org" } })).id;
  });

  afterEach(async () => {
    // Filtering by name is unsafe: anonymizeCandidateRecord renames the row
    // to "Anonymized Candidate <id>", which no longer contains "Erasure";
    // filtering by candidate.createdById is unsafe for a HARD_DELETE row,
    // whose candidateId goes null (onDelete: SetNull) once the candidate is
    // gone. requestedById/decidedById always stay the real test user ids
    // regardless of either, so they're the reliable filter.
    const testCreatorIds = [deleteOnlyUser.userId, decideUser.userId];
    await prisma.dataErasureRequest.deleteMany({
      where: { OR: [{ requestedById: { in: testCreatorIds } }, { decidedById: { in: testCreatorIds } }] },
    });
    await prisma.application.deleteMany({ where: { candidate: { createdById: { in: testCreatorIds } } } });
    await prisma.candidate.deleteMany({ where: { createdById: { in: testCreatorIds } } });
    await prisma.job.deleteMany({ where: { title: "Test Erasure Job" } });
    await prisma.auditLog.deleteMany({ where: { entityType: { in: ["DATA_ERASURE_REQUEST", "CANDIDATE"] } } });
    await prisma.organization.update({ where: { id: organizationId }, data: { candidateRetentionDays: null } });
  });

  afterAll(async () => {
    if (!organizationPreExisted) {
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await prisma.userRole.deleteMany({ where: { roleId: { in: [deleteOnlyRoleId, decideRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({
      where: { email: { in: ["erasure-deleteonly@test.local", "erasure-decide@test.local", "erasure-noaccess@test.local"] } },
    });
    await prisma.role.deleteMany({ where: { id: { in: [deleteOnlyRoleId, decideRoleId, noAccessRoleId] } } });
  });

  describe("requestCandidateErasure", () => {
    it("creates a PENDING request for a caller who could already hard-delete the candidate", async () => {
      const candidate = await freshCandidate();
      const request = await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "ANONYMIZE" });
      expect(request.status).toBe("PENDING");
      expect(request.method).toBe("ANONYMIZE");
    });

    it("throws ForbiddenError for a caller without CANDIDATE:DELETE", async () => {
      const candidate = await freshCandidate();
      await expect(
        requestCandidateErasure(noAccessUser, candidate.id, { method: "ANONYMIZE" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws NotFoundError for an unknown candidate", async () => {
      await expect(
        requestCandidateErasure(deleteOnlyUser, "nonexistent-candidate", { method: "ANONYMIZE" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ConflictError when a pending request already exists for this candidate", async () => {
      const candidate = await freshCandidate();
      await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "ANONYMIZE" });
      await expect(
        requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "HARD_DELETE" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("throws ConflictError for an already-anonymized candidate", async () => {
      const candidate = await freshCandidate({ anonymizedAt: new Date() });
      await expect(
        requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "ANONYMIZE" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("listCandidateErasureRequests", () => {
    it("throws ForbiddenError for a caller without CANDIDATE:APPROVE at ALL scope", async () => {
      await expect(listCandidateErasureRequests(deleteOnlyUser, { page: 1, pageSize: 25 })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("lists requests for a caller with the ALL-scope decide grant", async () => {
      const candidate = await freshCandidate();
      await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "ANONYMIZE" });

      const { requests, total } = await listCandidateErasureRequests(decideUser, { page: 1, pageSize: 25 });
      expect(total).toBeGreaterThanOrEqual(1);
      expect(requests.some((r) => r.candidateId === candidate.id)).toBe(true);
    });
  });

  describe("listMyErasureRequestsForCandidate", () => {
    it("returns only the caller's own requests for that candidate, newest first, with no special grant needed", async () => {
      const candidate = await freshCandidate();
      const first = await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "ANONYMIZE" });
      await decideCandidateErasureRequest(decideUser, first.id, { decision: "REJECT" });
      const second = await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "HARD_DELETE" });

      const mine = await listMyErasureRequestsForCandidate(deleteOnlyUser, candidate.id);
      expect(mine.map((r) => r.id)).toEqual([second.id, first.id]);
    });

    it("never surfaces a request another user filed for the same candidate", async () => {
      const candidate = await freshCandidate();
      await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "ANONYMIZE" });

      const mine = await listMyErasureRequestsForCandidate(decideUser, candidate.id);
      expect(mine).toEqual([]);
    });

    it("returns an empty array for a candidate the caller never filed a request for", async () => {
      const candidate = await freshCandidate();
      const mine = await listMyErasureRequestsForCandidate(deleteOnlyUser, candidate.id);
      expect(mine).toEqual([]);
    });
  });

  describe("decideCandidateErasureRequest", () => {
    it("throws ForbiddenError for a caller without CANDIDATE:APPROVE at ALL scope", async () => {
      const candidate = await freshCandidate();
      const request = await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "ANONYMIZE" });
      await expect(
        decideCandidateErasureRequest(deleteOnlyUser, request.id, { decision: "APPROVE" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("REJECT marks the request rejected without changing the candidate", async () => {
      const candidate = await freshCandidate();
      const request = await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "ANONYMIZE" });

      const decided = await decideCandidateErasureRequest(decideUser, request.id, {
        decision: "REJECT",
        decisionNotes: "Not eligible.",
      });
      expect(decided.status).toBe("REJECTED");

      const unchanged = await prisma.candidate.findUnique({ where: { id: candidate.id } });
      expect(unchanged?.name).toBe("Erasure Test Candidate");
      expect(unchanged?.anonymizedAt).toBeNull();
    });

    it("APPROVE + ANONYMIZE overwrites PII, deletes documents, redacts notes, and sets anonymizedAt", async () => {
      const candidate = await freshCandidate({
        email: "erase-me@test.local",
        experienceHistory: [{ company: "Acme", title: "Eng" }],
        customFields: { note: "sensitive" },
      });
      await prisma.candidateNote.create({ data: { candidateId: candidate.id, body: "Real PII note", authorId: decideUser.userId } });

      const request = await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "ANONYMIZE" });
      const decided = await decideCandidateErasureRequest(decideUser, request.id, { decision: "APPROVE" });
      expect(decided.status).toBe("COMPLETED");

      const erased = await prisma.candidate.findUnique({ where: { id: candidate.id }, include: { notes: true, documents: true } });
      expect(erased?.anonymizedAt).not.toBeNull();
      expect(erased?.name).not.toBe("Erasure Test Candidate");
      expect(erased?.email).toBeNull();
      expect(erased?.experienceHistory).toBeNull();
      expect(erased?.customFields).toBeNull();
      expect(erased?.documents).toHaveLength(0);
      expect(erased?.notes[0]?.body).toContain("redacted");

      const entry = await prisma.auditLog.findFirst({ where: { action: "candidate.anonymized", entityId: candidate.id } });
      expect(entry).not.toBeNull();
    });

    it("APPROVE + HARD_DELETE removes the candidate outright when it has no applications", async () => {
      const candidate = await freshCandidate();
      const request = await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "HARD_DELETE" });
      await decideCandidateErasureRequest(decideUser, request.id, { decision: "APPROVE" });

      expect(await prisma.candidate.findUnique({ where: { id: candidate.id } })).toBeNull();
    });

    it("APPROVE + HARD_DELETE is blocked (ValidationError) when the candidate has an application", async () => {
      const department = await prisma.controlledList.create({
        data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
      });
      const departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;
      const location = await prisma.controlledList.create({
        data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
      });
      const locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

      try {
        const job = await createJob(decideUser, {
          title: "Test Erasure Job",
          departmentId,
          locationId,
          employmentType: "FULL_TIME",
          priority: "MEDIUM",
          positionsCount: 1,
          mustHaveCriteria: [],
          goodToHaveCriteria: [],
          recruiterUserIds: [decideUser.userId],
          primaryRecruiterUserId: decideUser.userId,
        } as JobCreateInput);

        const candidate = await freshCandidate();
        await createApplication(decideUser, {
          candidateId: candidate.id,
          jobId: job.id,
        } as Parameters<typeof createApplication>[1]);

        const request = await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "HARD_DELETE" });
        await expect(
          decideCandidateErasureRequest(decideUser, request.id, { decision: "APPROVE" }),
        ).rejects.toBeInstanceOf(ValidationError);
      } finally {
        await prisma.application.deleteMany({ where: { job: { title: "Test Erasure Job" } } });
        await prisma.job.deleteMany({ where: { title: "Test Erasure Job" } });
        await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
        await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
      }
    });

    it("throws ConflictError when deciding an already-decided request", async () => {
      const candidate = await freshCandidate();
      const request = await requestCandidateErasure(deleteOnlyUser, candidate.id, { method: "ANONYMIZE" });
      await decideCandidateErasureRequest(decideUser, request.id, { decision: "REJECT" });

      await expect(
        decideCandidateErasureRequest(decideUser, request.id, { decision: "REJECT" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("runDueRetentionSweeps", () => {
    it("is a no-op when candidateRetentionDays is not configured", async () => {
      const result = await runDueRetentionSweeps(new Date());
      expect(result).toEqual({ evaluatedCount: 0, anonymizedCount: 0 });
    });

    it("anonymizes a candidate created past the retention window", async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { candidateRetentionDays: 30 } });

      const oldCreatedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const candidate = await freshCandidate({ createdAt: oldCreatedAt });

      const result = await runDueRetentionSweeps(new Date());
      expect(result.anonymizedCount).toBe(1);

      const swept = await prisma.candidate.findUnique({ where: { id: candidate.id } });
      expect(swept?.anonymizedAt).not.toBeNull();

      const request = await prisma.dataErasureRequest.findFirst({ where: { candidateId: candidate.id } });
      expect(request?.status).toBe("COMPLETED");
      expect(request?.requestedById).toBeNull();
    });

    it("skips a candidate past the window who has an ACTIVE application", async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { candidateRetentionDays: 30 } });

      const department = await prisma.controlledList.create({
        data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
      });
      const departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;
      const location = await prisma.controlledList.create({
        data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
      });
      const locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

      try {
        const job = await createJob(decideUser, {
          title: "Test Erasure Job",
          departmentId,
          locationId,
          employmentType: "FULL_TIME",
          priority: "MEDIUM",
          positionsCount: 1,
          mustHaveCriteria: [],
          goodToHaveCriteria: [],
          recruiterUserIds: [decideUser.userId],
          primaryRecruiterUserId: decideUser.userId,
        } as JobCreateInput);

        const oldCreatedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const candidate = await freshCandidate({ createdAt: oldCreatedAt });
        await createApplication(decideUser, {
          candidateId: candidate.id,
          jobId: job.id,
        } as Parameters<typeof createApplication>[1]);

        const result = await runDueRetentionSweeps(new Date());
        expect(result.anonymizedCount).toBe(0);

        const unchanged = await prisma.candidate.findUnique({ where: { id: candidate.id } });
        expect(unchanged?.anonymizedAt).toBeNull();
      } finally {
        await prisma.application.deleteMany({ where: { job: { title: "Test Erasure Job" } } });
        await prisma.job.deleteMany({ where: { title: "Test Erasure Job" } });
        await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
        await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
      }
    });

    it("is idempotent — re-running finds nothing left to sweep", async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { candidateRetentionDays: 30 } });
      const oldCreatedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      await freshCandidate({ createdAt: oldCreatedAt });

      const first = await runDueRetentionSweeps(new Date());
      expect(first.anonymizedCount).toBe(1);

      const second = await runDueRetentionSweeps(new Date());
      expect(second.anonymizedCount).toBe(0);
    });

    it("does not sweep a candidate still within the retention window", async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { candidateRetentionDays: 365 } });
      const candidate = await freshCandidate();

      const result = await runDueRetentionSweeps(new Date());
      expect(result.anonymizedCount).toBe(0);

      const unchanged = await prisma.candidate.findUnique({ where: { id: candidate.id } });
      expect(unchanged?.anonymizedAt).toBeNull();
    });
  });
});
