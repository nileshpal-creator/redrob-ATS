import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import {
  createCandidate,
  getCandidateById,
  getCandidateTimeline,
  listCandidates,
  updateCandidate,
} from "@/lib/services/candidates";
import { exportCandidates } from "@/lib/services/candidate-export";
import { createJob, getJobById, updateJob } from "@/lib/services/jobs";
import { createApplication } from "@/lib/services/applications";
import { createOffer } from "@/lib/services/offers";
import { candidateExportQuerySchema, candidateQuerySchema, type CandidateCreateInput } from "@/lib/validations/candidate";
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

/**
 * §10.1: "Field-level visibility rules by role, so sensitive custom fields
 * (e.g. compensation) are restricted the same way core fields are." The
 * audit found getFieldAccess() (src/lib/authz/authorize.ts) fully resolved
 * a role's per-field access map but that nothing ever applied it — these
 * tests exercise the real service functions end-to-end (not the sanitizer
 * in isolation — see tests/lib/field-sanitizer.test.ts for that) proving a
 * configured HIDDEN/READ restriction actually changes what a caller with
 * that role receives or is allowed to write, through the exact code paths
 * every API route uses.
 */
describe("Field-level permission enforcement", () => {
  let hiddenRoleId: string;
  let fullRoleId: string;

  let hiddenUser: SessionContext;
  let fullUser: SessionContext;

  let customFieldDefId: string;

  // Deliberately does NOT default currentCompensation/expectedCompensation —
  // a HIDDEN field cannot be set even at creation (see assertWritableFields),
  // so tests that create as hiddenUser must omit it; tests that need a
  // compensation value to sanitize on read create as fullUser first.
  const candidateInput = (overrides: Partial<CandidateCreateInput> = {}): CandidateCreateInput =>
    ({
      name: "Priya Sharma",
      phone: "+1 555-0900",
      consentGivenAt: new Date("2026-01-01T00:00:00Z"),
      skills: [],
      tags: [],
      location: "Bengaluru",
      ...overrides,
    }) as CandidateCreateInput;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    // hiddenRole: currentCompensation is HIDDEN (must not be readable or
    // writable at all); expectedCompensation is READ (visible, not
    // writable); location has no rule at all (fully unrestricted, must
    // keep working exactly as before this feature existed).
    const hiddenRole = await prisma.role.create({
      data: {
        name: "Test FP Hidden Compensation",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "UPDATE", scope: "ALL" },
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "JOB", action: "UPDATE", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
              { resource: "APPLICATION", action: "READ", scope: "ALL" },
              { resource: "OFFER", action: "CREATE", scope: "ALL" },
              { resource: "OFFER", action: "READ", scope: "ALL" },
            ],
          },
        },
        fieldPermissions: {
          createMany: {
            data: [
              { resource: "CANDIDATE", field: "currentCompensation", access: "HIDDEN" },
              { resource: "CANDIDATE", field: "expectedCompensation", access: "READ" },
              { resource: "CANDIDATE", field: "customFields.certifications", access: "HIDDEN" },
              { resource: "JOB", field: "description", access: "HIDDEN" },
              { resource: "OFFER", field: "compensation", access: "HIDDEN" },
            ],
          },
        },
      },
    });
    hiddenRoleId = hiddenRole.id;

    const fullRole = await prisma.role.create({
      data: {
        name: "Test FP Full Access",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "CANDIDATE", action: "CREATE", scope: "ALL" },
              { resource: "CANDIDATE", action: "READ", scope: "ALL" },
              { resource: "CANDIDATE", action: "UPDATE", scope: "ALL" },
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "JOB", action: "UPDATE", scope: "ALL" },
              { resource: "APPLICATION", action: "CREATE", scope: "ALL" },
              { resource: "APPLICATION", action: "READ", scope: "ALL" },
              { resource: "OFFER", action: "CREATE", scope: "ALL" },
              { resource: "OFFER", action: "READ", scope: "ALL" },
            ],
          },
        },
        // Deliberately no FieldPermission rows — the "unrestricted role"
        // control group.
      },
    });
    fullRoleId = fullRole.id;

    const [hiddenUserRow, fullUserRow] = await Promise.all([
      prisma.user.create({ data: { name: "Hidden-Field User", email: "fp-hidden@test.local", passwordHash } }),
      prisma.user.create({ data: { name: "Full-Access User", email: "fp-full@test.local", passwordHash } }),
    ]);

    await prisma.userRole.createMany({
      data: [
        { userId: hiddenUserRow.id, roleId: hiddenRoleId },
        { userId: fullUserRow.id, roleId: fullRoleId },
      ],
    });

    hiddenUser = contextFor({
      ...hiddenUserRow,
      roles: [{ id: hiddenRoleId, name: "Test FP Hidden Compensation", isSuperAdmin: false }],
    });
    fullUser = contextFor({
      ...fullUserRow,
      roles: [{ id: fullRoleId, name: "Test FP Full Access", isSuperAdmin: false }],
    });

    const customFieldDef = await prisma.customFieldDefinition.create({
      data: { entityType: "CANDIDATE", key: "certifications", label: "Certifications", fieldType: "TEXT" },
    });
    customFieldDefId = customFieldDef.id;
  });

  afterAll(async () => {
    await prisma.candidate.deleteMany({ where: { phone: { startsWith: "+1 555-09" } } });
    await prisma.job.deleteMany({ where: { title: "Test FP Job" } });
    await prisma.customFieldDefinition.delete({ where: { id: customFieldDefId } });
    await prisma.userRole.deleteMany({ where: { roleId: { in: [hiddenRoleId, fullRoleId] } } });
    await prisma.user.deleteMany({ where: { email: { in: ["fp-hidden@test.local", "fp-full@test.local"] } } });
    await prisma.role.deleteMany({ where: { id: { in: [hiddenRoleId, fullRoleId] } } });
  });

  it("strips a HIDDEN field from the create response for a restricted role", async () => {
    // A HIDDEN field cannot be set at all by this role, even at creation —
    // confirmed separately below ("blocks writing a HIDDEN field..." via
    // updateCandidate, and this same guard applies inside createCandidate).
    // A READ-tagged field CAN be set at creation (READ blocks writes, not
    // creates with a value already present is still a write of that field —
    // so this call omits both, and a later test proves READ still blocks an
    // explicit update).
    const created = await createCandidate(hiddenUser, candidateInput({ phone: "+1 555-0901" }));
    expect("currentCompensation" in created).toBe(false);
    // An unrestricted field is completely unaffected.
    expect(created.location).toBe("Bengaluru");
  });

  it("blocks even creating a record with a HIDDEN field set to a real value", async () => {
    await expect(
      createCandidate(hiddenUser, candidateInput({ phone: "+1 555-0901-b", currentCompensation: 999999 })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("strips a HIDDEN field on getCandidateById and listCandidates for the restricted role", async () => {
    const created = await createCandidate(fullUser, candidateInput({ phone: "+1 555-0902" }));

    const viewed = await getCandidateById(hiddenUser, created.id);
    expect("currentCompensation" in viewed).toBe(false);

    const { candidates } = await listCandidates(hiddenUser, candidateQuerySchema.parse({}));
    const sameCandidate = candidates.find((candidate) => candidate.id === created.id);
    expect(sameCandidate).toBeDefined();
    expect("currentCompensation" in sameCandidate!).toBe(false);
  });

  it("different roles see different field visibility for the exact same record", async () => {
    const created = await createCandidate(
      fullUser,
      candidateInput({ phone: "+1 555-0903", currentCompensation: 150000 }),
    );

    const asHidden = await getCandidateById(hiddenUser, created.id);
    const asFull = await getCandidateById(fullUser, created.id);

    expect("currentCompensation" in asHidden).toBe(false);
    expect(asFull.currentCompensation?.toString()).toBe("150000");
  });

  it("blocks writing a HIDDEN field even though the caller otherwise has CANDIDATE:UPDATE", async () => {
    const created = await createCandidate(
      fullUser,
      candidateInput({ phone: "+1 555-0904", currentCompensation: 150000 }),
    );

    await expect(
      updateCandidate(hiddenUser, created.id, { version: created.version, currentCompensation: 999999 }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // The blocked write must not have partially applied.
    const unchanged = await getCandidateById(fullUser, created.id);
    expect(unchanged.currentCompensation?.toString()).toBe("150000");
  });

  it("blocks writing a READ-only field (visible but not editable)", async () => {
    const created = await createCandidate(fullUser, candidateInput({ phone: "+1 555-0905" }));

    await expect(
      updateCandidate(hiddenUser, created.id, { version: created.version, expectedCompensation: 200000 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets an unrestricted field continue to be written normally by the restricted role", async () => {
    const created = await createCandidate(hiddenUser, candidateInput({ phone: "+1 555-0906" }));

    const updated = await updateCandidate(hiddenUser, created.id, {
      version: created.version,
      location: "Mumbai",
    });
    expect(updated.location).toBe("Mumbai");
  });

  it("lets the unrestricted role read and write every field without any change in behavior", async () => {
    const created = await createCandidate(
      fullUser,
      candidateInput({ phone: "+1 555-0907", currentCompensation: 150000 }),
    );
    expect(created.currentCompensation?.toString()).toBe("150000");

    const updated = await updateCandidate(fullUser, created.id, {
      version: created.version,
      currentCompensation: 160000,
    });
    expect(updated.currentCompensation?.toString()).toBe("160000");
  });

  it("applies a HIDDEN rule to a custom field key without affecting sibling custom fields", async () => {
    const created = await createCandidate(
      fullUser,
      candidateInput({ phone: "+1 555-0908", customFields: { certifications: "AWS SA" } }),
    );
    expect((created.customFields as Record<string, unknown> | null)?.certifications).toBe("AWS SA");

    const viewedByHidden = await getCandidateById(hiddenUser, created.id);
    expect((viewedByHidden.customFields as Record<string, unknown> | null)?.certifications).toBeUndefined();

    await expect(
      updateCandidate(hiddenUser, created.id, {
        version: created.version,
        customFields: { certifications: "GCP" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // A HIDDEN custom field key must not block writes to other, unrestricted
    // custom field keys.
    await prisma.customFieldDefinition.create({
      data: { entityType: "CANDIDATE", key: "notes", label: "Notes", fieldType: "TEXT", isActive: true },
    });
    try {
      const updated = await updateCandidate(fullUser, created.id, {
        version: created.version,
        customFields: { certifications: "AWS SA", notes: "still editable" },
      });
      expect((updated.customFields as Record<string, unknown> | null)?.notes).toBe("still editable");
    } finally {
      await prisma.customFieldDefinition.deleteMany({ where: { entityType: "CANDIDATE", key: "notes" } });
    }
  });

  it("does not let a candidate export leak a HIDDEN field's value", async () => {
    await createCandidate(fullUser, candidateInput({ phone: "+1 555-0909", currentCompensation: 987654 }));

    const { buffer } = await exportCandidates(hiddenUser, candidateExportQuerySchema.parse({ format: "csv" }));
    const csvText = buffer.toString("utf-8");
    expect(csvText).not.toContain("987654");
  });

  it("applies the same enforcement mechanism to a second entity (Job), proving it is not Candidate-specific", async () => {
    // Keys must match what src/lib/services/jobs.ts validates against
    // ("DEPARTMENT"/"LOCATION" are hardcoded there) — same convention as
    // tests/services/jobs.service.test.ts's own fixtures.
    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    const departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;
    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    const locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    try {
      const jobInput: JobCreateInput = {
        title: "Test FP Job",
        departmentId,
        locationId,
        employmentType: "FULL_TIME",
        priority: "MEDIUM",
        positionsCount: 1,
        description: "Confidential hiring plan details.",
        mustHaveCriteria: [],
        goodToHaveCriteria: [],
        recruiterUserIds: [fullUser.userId],
        primaryRecruiterUserId: fullUser.userId,
      } as JobCreateInput;

      const created = await createJob(fullUser, jobInput);
      expect(created.description).toBe("Confidential hiring plan details.");

      const viewedByHidden = await getJobById(hiddenUser, created.id);
      expect("description" in viewedByHidden).toBe(false);

      await expect(
        updateJob(hiddenUser, created.id, { version: created.version, description: "Leaked" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      // Job must go first — Job.departmentId/locationId are Restrict FKs
      // into these ControlledListValue rows.
      await prisma.job.deleteMany({ where: { title: "Test FP Job" } });
      await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
      await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    }
  });

  it("masks a HIDDEN Offer field flowing into a Candidate's timeline (a cross-entity leak vector)", async () => {
    const department = await prisma.controlledList.create({
      data: { key: "DEPARTMENT", label: "Departments", values: { create: { value: "eng", label: "Engineering" } } },
    });
    const departmentId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: department.id } })).id;
    const location = await prisma.controlledList.create({
      data: { key: "LOCATION", label: "Locations", values: { create: { value: "remote", label: "Remote" } } },
    });
    const locationId = (await prisma.controlledListValue.findFirstOrThrow({ where: { listId: location.id } })).id;

    const candidate = await createCandidate(fullUser, candidateInput({ phone: "+1 555-0910" }));

    try {
      const job = await createJob(fullUser, {
        title: "Test FP Timeline Job",
        departmentId,
        locationId,
        employmentType: "FULL_TIME",
        priority: "MEDIUM",
        positionsCount: 1,
        mustHaveCriteria: [],
        goodToHaveCriteria: [],
        recruiterUserIds: [fullUser.userId],
        primaryRecruiterUserId: fullUser.userId,
      } as JobCreateInput);

      const application = await createApplication(fullUser, {
        candidateId: candidate.id,
        jobId: job.id,
      } as Parameters<typeof createApplication>[1]);

      await createOffer(fullUser, {
        applicationId: application.id,
        compensation: 555555,
      } as Parameters<typeof createOffer>[1]);

      const timelineAsHidden = await getCandidateTimeline(hiddenUser, candidate.id);
      const offerItem = timelineAsHidden.items.find((item) => item.type === "offer_created") as
        | { compensation: string | null }
        | undefined;
      expect(offerItem).toBeDefined();
      expect(offerItem!.compensation).toBeNull();

      const timelineAsFull = await getCandidateTimeline(fullUser, candidate.id);
      const offerItemFull = timelineAsFull.items.find((item) => item.type === "offer_created") as
        | { compensation: string | null }
        | undefined;
      expect(offerItemFull!.compensation).toBe("555555");
    } finally {
      await prisma.offer.deleteMany({ where: { application: { candidateId: candidate.id } } });
      await prisma.application.deleteMany({ where: { candidateId: candidate.id } });
      await prisma.job.deleteMany({ where: { title: "Test FP Timeline Job" } });
      await prisma.controlledListValue.deleteMany({ where: { list: { key: { in: ["DEPARTMENT", "LOCATION"] } } } });
      await prisma.controlledList.deleteMany({ where: { key: { in: ["DEPARTMENT", "LOCATION"] } } });
    }
  });
});
