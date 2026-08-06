import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ConflictError, DuplicateCandidateError, ValidationError } from "@/lib/errors";
import {
  addCandidateDocument,
  addCandidateNote,
  checkCandidateDuplicates,
  createCandidate,
  deleteCandidate,
  deleteCandidateDocument,
  getCandidateById,
  getCandidateDocumentForDownload,
  getCandidateTimeline,
  listCandidates,
  mergeCandidates,
  updateCandidate,
} from "@/lib/services/candidates";
import { commitCandidateImport, previewCandidateImport } from "@/lib/services/candidate-import";
import { exportCandidates } from "@/lib/services/candidate-export";
import { candidateExportQuerySchema, candidateQuerySchema, type CandidateCreateInput } from "@/lib/validations/candidate";

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

describe("CandidateService", () => {
  let recruiterRoleId: string;
  let hiringManagerRoleId: string;
  let noAccessRoleId: string;

  let recruiter: SessionContext;
  let otherRecruiter: SessionContext;
  let hiringManager: SessionContext;
  let noAccessUser: SessionContext;

  let sourceId: string;
  let documentTypeId: string;

  const baseInput = (overrides: Partial<CandidateCreateInput> = {}): CandidateCreateInput =>
    ({
      name: "Jane Doe",
      phone: "+1 555-0100",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
      ...overrides,
    }) as CandidateCreateInput;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test Candidate Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "OWN" },
              { resource: "CANDIDATE", action: "UPDATE", scope: "OWN" },
              { resource: "CANDIDATE", action: "DELETE", scope: "OWN" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const hiringManagerRole = await prisma.role.create({
      data: {
        name: "Test Candidate Hiring Manager",
        rolePermissions: {
          createMany: { data: [{ resource: "CANDIDATE", action: "READ", scope: "ALL" }] },
        },
      },
    });
    hiringManagerRoleId = hiringManagerRole.id;

    const noAccessRole = await prisma.role.create({ data: { name: "Test Candidate No Access" } });
    noAccessRoleId = noAccessRole.id;

    const [recruiterUser, otherRecruiterUser, hiringManagerUser, noAccessUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "Recruiter One", email: "cand-recruiter1@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Recruiter Two", email: "cand-recruiter2@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Hiring Manager", email: "cand-hm1@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "No Access", email: "cand-noaccess@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: recruiterUser.id, roleId: recruiterRoleId },
        { userId: otherRecruiterUser.id, roleId: recruiterRoleId },
        { userId: hiringManagerUser.id, roleId: hiringManagerRoleId },
        { userId: noAccessUserRow.id, roleId: noAccessRoleId },
      ],
    });

    recruiter = contextFor({
      ...recruiterUser,
      roles: [{ id: recruiterRoleId, name: "Test Candidate Recruiter", isSuperAdmin: false }],
    });
    otherRecruiter = contextFor({
      ...otherRecruiterUser,
      roles: [{ id: recruiterRoleId, name: "Test Candidate Recruiter", isSuperAdmin: false }],
    });
    hiringManager = contextFor({
      ...hiringManagerUser,
      roles: [{ id: hiringManagerRoleId, name: "Test Candidate Hiring Manager", isSuperAdmin: false }],
    });
    noAccessUser = contextFor({
      ...noAccessUserRow,
      roles: [{ id: noAccessRoleId, name: "Test Candidate No Access", isSuperAdmin: false }],
    });

    const sourceList = await prisma.controlledList.create({
      data: { key: "CANDIDATE_SOURCE", label: "Sources", values: { create: { value: "referral", label: "Referral" } } },
    });
    sourceId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: sourceList.id } })).id;

    const docTypeList = await prisma.controlledList.create({
      data: { key: "DOCUMENT_TYPE", label: "Document Types", values: { create: { value: "resume", label: "Resume" } } },
    });
    documentTypeId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: docTypeList.id } })).id;
  });

  afterAll(async () => {
    await prisma.candidateNote.deleteMany({});
    await prisma.candidateDocument.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.controlledListValue.deleteMany({
      where: { list: { key: { in: ["CANDIDATE_SOURCE", "DOCUMENT_TYPE"] } } },
    });
    await prisma.controlledList.deleteMany({ where: { key: { in: ["CANDIDATE_SOURCE", "DOCUMENT_TYPE"] } } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [recruiterRoleId, hiringManagerRoleId, noAccessRoleId] } } });
    await prisma.user.deleteMany({
      where: {
        email: { in: ["cand-recruiter1@test.local", "cand-recruiter2@test.local", "cand-hm1@test.local", "cand-noaccess@test.local"] },
      },
    });
    await prisma.role.deleteMany({ where: { id: { in: [recruiterRoleId, hiringManagerRoleId, noAccessRoleId] } } });
  });

  it("creates a candidate owned by its creator", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0101" }));
    expect(candidate.createdById).toBe(recruiter.userId);
    expect(candidate.version).toBe(0);
    expect(candidate.possibleDuplicateOf).toBeNull();
  });

  it("rejects creation from a user without CANDIDATE:CREATE", async () => {
    await expect(createCandidate(noAccessUser, baseInput({ phone: "+1 555-0102" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("blocks a hard duplicate by phone and surfaces the existing candidate id", async () => {
    const first = await createCandidate(recruiter, baseInput({ phone: "+1 555-0103" }));

    const error = await createCandidate(recruiter, baseInput({ phone: "+1 555-0103", name: "Someone Else" })).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(DuplicateCandidateError);
    expect((error as DuplicateCandidateError).existingCandidateId).toBe(first.id);
  });

  it("never blocks on an email-only (soft) duplicate, but flags it in the response", async () => {
    await createCandidate(recruiter, baseInput({ phone: "+1 555-0104", email: "shared@test.local" }));

    const second = await createCandidate(
      recruiter,
      baseInput({ phone: "+1 555-0105", email: "shared@test.local" }),
    );
    expect(second.possibleDuplicateOf).not.toBeNull();
  });

  it("checkCandidateDuplicates reports hard and soft matches without mutating anything", async () => {
    const created = await createCandidate(recruiter, baseInput({ phone: "+1 555-0106", email: "check@test.local" }));

    const result = await checkCandidateDuplicates(recruiter, { phone: "+1 555-0106", email: "check@test.local" });
    expect(result.hardMatch?.id).toBe(created.id);
  });

  it("lets the creator (OWN scope) update their candidate, but not a peer recruiter", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0107" }));

    const updated = await updateCandidate(recruiter, candidate.id, { version: candidate.version, name: "Updated Name" });
    expect(updated.name).toBe("Updated Name");

    await expect(
      updateCandidate(otherRecruiter, candidate.id, { version: updated.version, name: "Hijacked" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a stale version with ConflictError", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0108" }));
    await updateCandidate(recruiter, candidate.id, { version: candidate.version, name: "First edit" });

    await expect(
      updateCandidate(recruiter, candidate.id, { version: candidate.version, name: "Stale edit" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects updating phone to one already used by another candidate", async () => {
    const first = await createCandidate(recruiter, baseInput({ phone: "+1 555-0109" }));
    const second = await createCandidate(recruiter, baseInput({ phone: "+1 555-0110" }));

    await expect(
      updateCandidate(recruiter, second.id, { version: second.version, phone: first.phone }),
    ).rejects.toBeInstanceOf(DuplicateCandidateError);
  });

  it("scopes listCandidates to OWN records for a plain Recruiter grant", async () => {
    const mine = await createCandidate(recruiter, baseInput({ phone: "+1 555-0111" }));
    await createCandidate(otherRecruiter, baseInput({ phone: "+1 555-0112" }));

    const { candidates } = await listCandidates(recruiter, candidateQuerySchema.parse({ page: 1, pageSize: 25 }));
    const ids = candidates.map((candidate) => candidate.id);
    expect(ids).toContain(mine.id);
    expect(candidates.every((candidate) => candidate.createdById === recruiter.userId)).toBe(true);
  });

  it("lets a Hiring Manager (ALL scope, READ only) view any candidate but not edit it", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0140" }));

    const viaHiringManager = await getCandidateById(hiringManager, candidate.id);
    expect(viaHiringManager.id).toBe(candidate.id);

    await expect(
      updateCandidate(hiringManager, candidate.id, { version: candidate.version, name: "Not allowed" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("denies listCandidates entirely for a role with no CANDIDATE:READ grant", async () => {
    await expect(
      listCandidates(noAccessUser, candidateQuerySchema.parse({ page: 1, pageSize: 25 })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("filters by skills using any-match semantics", async () => {
    await createCandidate(recruiter, baseInput({ phone: "+1 555-0113", skills: ["SQL", "Python"] }));
    await createCandidate(recruiter, baseInput({ phone: "+1 555-0114", skills: ["Go"] }));

    const { candidates } = await listCandidates(
      recruiter,
      candidateQuerySchema.parse({ page: 1, pageSize: 25, skills: ["SQL"] }),
    );
    expect(candidates.every((candidate) => candidate.skills.includes("SQL"))).toBe(true);
  });

  it("rejects a sourceId that does not belong to the CANDIDATE_SOURCE list", async () => {
    await expect(
      createCandidate(recruiter, baseInput({ phone: "+1 555-0115", sourceId: documentTypeId })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts a valid sourceId", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0116", sourceId }));
    expect(candidate.sourceId).toBe(sourceId);
  });

  it("deletes a candidate the creator owns, cascading documents and notes", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0117" }));
    await addCandidateNote(recruiter, candidate.id, { body: "A note" });
    await addCandidateDocument(recruiter, candidate.id, {
      documentTypeId,
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 test"),
    });

    await deleteCandidate(recruiter, candidate.id);

    expect(await prisma.candidate.findUnique({ where: { id: candidate.id } })).toBeNull();
    expect(await prisma.candidateNote.count({ where: { candidateId: candidate.id } })).toBe(0);
    expect(await prisma.candidateDocument.count({ where: { candidateId: candidate.id } })).toBe(0);
  });

  it("rejects deletion from a user without CANDIDATE:DELETE ownership", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0118" }));
    await expect(deleteCandidate(otherRecruiter, candidate.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("adds, downloads, and deletes a candidate document", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0119" }));
    const document = await addCandidateDocument(recruiter, candidate.id, {
      documentTypeId,
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 test content"),
    });
    expect(document.candidateId).toBe(candidate.id);

    const download = await getCandidateDocumentForDownload(recruiter, candidate.id, document.id);
    expect(download.buffer.toString()).toBe("%PDF-1.4 test content");

    await deleteCandidateDocument(recruiter, candidate.id, document.id);
    expect(await prisma.candidateDocument.findUnique({ where: { id: document.id } })).toBeNull();
  });

  it("rejects an oversized or disallowed document upload", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0120" }));

    await expect(
      addCandidateDocument(recruiter, candidate.id, {
        documentTypeId,
        fileName: "malware.exe",
        mimeType: "application/x-msdownload",
        buffer: Buffer.from("test"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      addCandidateDocument(recruiter, candidate.id, {
        documentTypeId,
        fileName: "huge.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(11 * 1024 * 1024),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("builds an extensible timeline from notes (create-only, no edit/delete)", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0121" }));
    await addCandidateNote(recruiter, candidate.id, { body: "First note" });
    await addCandidateNote(recruiter, candidate.id, { body: "Second note" });

    const timeline = await getCandidateTimeline(recruiter, candidate.id);
    expect(timeline.items).toHaveLength(2);
    expect(timeline.items.every((item) => item.type === "note")).toBe(true);
  });

  it("merges a source candidate into a target, filling only empty fields and unioning skills", async () => {
    const target = await createCandidate(
      recruiter,
      baseInput({ phone: "+1 555-0122", skills: ["SQL"], location: "Bangalore" }),
    );
    const source = await createCandidate(
      recruiter,
      baseInput({ phone: "+1 555-0123", skills: ["Python"], email: "from-source@test.local", location: "Pune" }),
    );
    await addCandidateNote(recruiter, source.id, { body: "Note on source" });

    const merged = await mergeCandidates(recruiter, target.id, {
      sourceCandidateId: source.id,
      version: target.version,
    });

    expect(merged.email).toBe("from-source@test.local"); // filled from source (target had none)
    expect(merged.location).toBe("Bangalore"); // target's populated value is never overwritten
    expect(merged.skills.sort()).toEqual(["Python", "SQL"]); // union
    expect(await prisma.candidate.findUnique({ where: { id: source.id } })).toBeNull();

    const timeline = await getCandidateTimeline(recruiter, target.id);
    expect(timeline.items.some((item) => item.body === "Note on source")).toBe(true);
  });

  it("requires CANDIDATE:DELETE on the source to merge, even with CANDIDATE:UPDATE on the target", async () => {
    const target = await createCandidate(recruiter, baseInput({ phone: "+1 555-0124" }));
    const source = await createCandidate(otherRecruiter, baseInput({ phone: "+1 555-0125" }));

    await expect(
      mergeCandidates(recruiter, target.id, { sourceCandidateId: source.id, version: target.version }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects merging a candidate into itself", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0126" }));
    await expect(
      mergeCandidates(recruiter, candidate.id, { sourceCandidateId: candidate.id, version: candidate.version }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("previews a CSV import: valid, duplicate, and invalid rows", async () => {
    const existing = await createCandidate(recruiter, baseInput({ phone: "+1 555-0127" }));

    const csv = [
      "name,phone,consentGivenAt",
      "New Person,+1 555-0128,2026-01-01",
      `Duplicate Person,${existing.phone},2026-01-01`,
      ",,", // invalid: missing name/phone
    ].join("\n");

    const preview = await previewCandidateImport(recruiter, Buffer.from(csv), "candidates.csv");
    expect(preview.rows).toHaveLength(3);
    expect(preview.rows[0].status).toBe("valid");
    expect(preview.rows[1].status).toBe("duplicate");
    expect(preview.rows[2].status).toBe("invalid");
  });

  it("never fabricates a consent timestamp for an import row missing one — treats it as invalid instead", async () => {
    const csv = ["name,phone", "No Consent Column,+1 555-0135"].join("\n");

    const preview = await previewCandidateImport(recruiter, Buffer.from(csv), "candidates.csv");
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].status).toBe("invalid");
    expect(preview.rows[0].data.consentGivenAt).toBeUndefined();
  });

  it("commits an import, creating valid rows and skipping duplicates", async () => {
    const existing = await createCandidate(recruiter, baseInput({ phone: "+1 555-0129" }));

    const result = await commitCandidateImport(recruiter, {
      rows: [
        baseInput({ phone: "+1 555-0130", name: "Committed Person" }),
        baseInput({ phone: existing.phone, name: "Duplicate Person" }),
      ],
    });

    expect(result.created).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].existingCandidateId).toBe(existing.id);
  });

  it("exports candidates as CSV, scoped like the list endpoint, and writes an audit log entry", async () => {
    await createCandidate(recruiter, baseInput({ phone: "+1 555-0131", name: "Export Me" }));

    const { buffer, mimeType } = await exportCandidates(recruiter, candidateExportQuerySchema.parse({ format: "csv" }));
    expect(mimeType).toBe("text/csv");
    expect(buffer.toString()).toContain("Export Me");

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: "candidate.exported", actorId: recruiter.userId },
      orderBy: { createdAt: "desc" },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("rejects export from a user without CANDIDATE:READ", async () => {
    await expect(
      exportCandidates(noAccessUser, candidateExportQuerySchema.parse({ format: "csv" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("records an AuditLog entry with the correct actor for create, update, and delete", async () => {
    const candidate = await createCandidate(recruiter, baseInput({ phone: "+1 555-0132" }));
    const createdLog = await prisma.auditLog.findFirst({ where: { action: "candidate.created", entityId: candidate.id } });
    expect(createdLog?.actorId).toBe(recruiter.userId);

    await updateCandidate(recruiter, candidate.id, { version: candidate.version, name: "Audited" });
    const updatedLog = await prisma.auditLog.findFirst({ where: { action: "candidate.updated", entityId: candidate.id } });
    expect(updatedLog?.actorId).toBe(recruiter.userId);

    await deleteCandidate(recruiter, candidate.id);
    const deletedLog = await prisma.auditLog.findFirst({ where: { action: "candidate.deleted", entityId: candidate.id } });
    expect(deletedLog?.actorId).toBe(recruiter.userId);
  });
});

describe("CandidateService — Recruiting Manager TEAM scope", () => {
  let managerRoleId: string;
  let reporteeRoleId: string;
  let manager: SessionContext;
  let directReport: SessionContext;
  let unrelatedRecruiter: SessionContext;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const managerRole = await prisma.role.create({
      data: {
        name: "Test Candidate Recruiting Manager",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "CANDIDATE", action: "READ", scope: "TEAM" },
              { resource: "CANDIDATE", action: "UPDATE", scope: "TEAM" },
            ],
          },
        },
      },
    });
    managerRoleId = managerRole.id;

    const reporteeRole = await prisma.role.create({
      data: {
        name: "Test Candidate Reportee",
        rolePermissions: { createMany: { data: [{ resource: "CANDIDATE", action: "CREATE", scope: "ALL" }] } },
      },
    });
    reporteeRoleId = reporteeRole.id;

    const managerUser = await prisma.user.create({
      data: { name: "Team Manager", email: "cand-team-manager@test.local", passwordHash },
    });
    const reporteeUser = await prisma.user.create({
      data: {
        name: "Team Reportee",
        email: "cand-team-reportee@test.local",
        passwordHash,
        managerId: managerUser.id,
      },
    });
    const unrelatedUser = await prisma.user.create({
      data: { name: "Unrelated Recruiter", email: "cand-unrelated@test.local", passwordHash },
    });

    await prisma.userRole.createMany({
      data: [
        { userId: managerUser.id, roleId: managerRoleId },
        { userId: reporteeUser.id, roleId: reporteeRoleId },
        { userId: unrelatedUser.id, roleId: reporteeRoleId },
      ],
    });

    manager = contextFor({ ...managerUser, roles: [{ id: managerRoleId, name: "Test Candidate Recruiting Manager", isSuperAdmin: false }] });
    directReport = contextFor({ ...reporteeUser, roles: [{ id: reporteeRoleId, name: "Test Candidate Reportee", isSuperAdmin: false }] });
    unrelatedRecruiter = contextFor({ ...unrelatedUser, roles: [{ id: reporteeRoleId, name: "Test Candidate Reportee", isSuperAdmin: false }] });
  });

  afterAll(async () => {
    await prisma.candidate.deleteMany({
      where: { createdById: { in: [directReport.userId, unrelatedRecruiter.userId] } },
    });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [managerRoleId, reporteeRoleId] } } });
    await prisma.user.deleteMany({
      where: { email: { in: ["cand-team-manager@test.local", "cand-team-reportee@test.local", "cand-unrelated@test.local"] } },
    });
    await prisma.role.deleteMany({ where: { id: { in: [managerRoleId, reporteeRoleId] } } });
  });

  it("lets a manager read and update their direct report's candidate via TEAM scope", async () => {
    const candidate = await createCandidate(directReport, {
      name: "Team candidate",
      phone: "+1 555-0200",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
    } as CandidateCreateInput);

    const viaManager = await getCandidateById(manager, candidate.id);
    expect(viaManager.id).toBe(candidate.id);

    const updated = await updateCandidate(manager, candidate.id, { version: 0, name: "Updated by manager" });
    expect(updated.name).toBe("Updated by manager");
  });

  it("blocks the same manager from an unrelated recruiter's candidate", async () => {
    const candidate = await createCandidate(unrelatedRecruiter, {
      name: "Not on the team",
      phone: "+1 555-0201",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
    } as CandidateCreateInput);

    await expect(getCandidateById(manager, candidate.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("scopes listCandidates to only the manager's team", async () => {
    const { candidates } = await listCandidates(manager, candidateQuerySchema.parse({ page: 1, pageSize: 50 }));
    expect(candidates.every((candidate) => candidate.createdById === directReport.userId)).toBe(true);
  });
});

describe("CandidateService — required custom fields", () => {
  let recruiterRoleId: string;
  let recruiter: SessionContext;
  let customFieldId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const role = await prisma.role.create({
      data: {
        name: "Test Candidate CF Recruiter",
        rolePermissions: { createMany: { data: [{ resource: "CANDIDATE", action: "CREATE", scope: "ALL" }] } },
      },
    });
    recruiterRoleId = role.id;

    const user = await prisma.user.create({
      data: { name: "CF Recruiter", email: "cand-cf-recruiter@test.local", passwordHash },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: recruiterRoleId } });
    recruiter = contextFor({ ...user, roles: [{ id: recruiterRoleId, name: "Test Candidate CF Recruiter", isSuperAdmin: false }] });

    const customField = await prisma.customFieldDefinition.create({
      data: {
        entityType: "CANDIDATE",
        key: "visa_status",
        label: "Visa Status",
        fieldType: "TEXT",
        isRequired: true,
        isActive: true,
      },
    });
    customFieldId = customField.id;
  });

  afterAll(async () => {
    await prisma.candidate.deleteMany({ where: { createdById: recruiter.userId } });
    await prisma.customFieldDefinition.delete({ where: { id: customFieldId } });
    await prisma.userRole.deleteMany({ where: { roleId: recruiterRoleId } });
    await prisma.user.deleteMany({ where: { email: "cand-cf-recruiter@test.local" } });
    await prisma.role.delete({ where: { id: recruiterRoleId } });
  });

  it("rejects creating a Candidate when a required custom field is missing", async () => {
    await expect(
      createCandidate(recruiter, {
        name: "Missing required custom field",
        phone: "+1 555-0300",
        consentGivenAt: new Date("2026-01-01T00:00:00Z"),
        skills: [],
        tags: [],
      } as CandidateCreateInput),
    ).rejects.toThrow();
  });

  it("accepts creation once the required custom field is supplied", async () => {
    const candidate = await createCandidate(recruiter, {
      name: "Has required custom field",
      phone: "+1 555-0301",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
      customFields: { visa_status: "Citizen" },
    } as CandidateCreateInput);

    expect(candidate.customFields).toMatchObject({ visa_status: "Citizen" });
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
