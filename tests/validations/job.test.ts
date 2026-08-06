import { describe, expect, it } from "vitest";

import {
  jobCreateSchema,
  jobQuerySchema,
  jobRecruitersUpdateSchema,
  jobStatusActionSchema,
  jobUpdateSchema,
} from "@/lib/validations/job";

const validCreate = {
  title: "Backend Engineer",
  departmentId: "dept-1",
  locationId: "loc-1",
  employmentType: "FULL_TIME",
  priority: "HIGH",
  positionsCount: 2,
  recruiterUserIds: ["user-1", "user-2"],
  primaryRecruiterUserId: "user-1",
};

describe("jobCreateSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = jobCreateSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  it("rejects an empty or whitespace-only title", () => {
    expect(jobCreateSchema.safeParse({ ...validCreate, title: "" }).success).toBe(false);
    expect(jobCreateSchema.safeParse({ ...validCreate, title: "   " }).success).toBe(false);
  });

  it("rejects a title over 200 characters", () => {
    expect(jobCreateSchema.safeParse({ ...validCreate, title: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects zero or negative positionsCount", () => {
    expect(jobCreateSchema.safeParse({ ...validCreate, positionsCount: 0 }).success).toBe(false);
    expect(jobCreateSchema.safeParse({ ...validCreate, positionsCount: -1 }).success).toBe(false);
  });

  it("rejects a non-integer positionsCount", () => {
    expect(jobCreateSchema.safeParse({ ...validCreate, positionsCount: 1.5 }).success).toBe(false);
  });

  it("rejects an empty recruiterUserIds array", () => {
    expect(jobCreateSchema.safeParse({ ...validCreate, recruiterUserIds: [] }).success).toBe(false);
  });

  it("rejects a primaryRecruiterUserId not present in recruiterUserIds", () => {
    const result = jobCreateSchema.safeParse({ ...validCreate, primaryRecruiterUserId: "someone-else" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown employmentType or priority", () => {
    expect(jobCreateSchema.safeParse({ ...validCreate, employmentType: "GIG" }).success).toBe(false);
    expect(jobCreateSchema.safeParse({ ...validCreate, priority: "CRITICAL" }).success).toBe(false);
  });

  it("deduplicates must-have/good-to-have criteria", () => {
    const result = jobCreateSchema.safeParse({
      ...validCreate,
      mustHaveCriteria: ["SQL", "SQL", "Python"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mustHaveCriteria).toEqual(["SQL", "Python"]);
    }
  });

  it("rejects a criteria entry that is empty after trimming", () => {
    const result = jobCreateSchema.safeParse({ ...validCreate, mustHaveCriteria: ["   "] });
    expect(result.success).toBe(false);
  });

  it("does not accept salary, hiring manager, or code fields (removed from scope)", () => {
    const result = jobCreateSchema.safeParse({
      ...validCreate,
      salaryMin: 1000,
      hiringManagerUserId: "someone",
      code: "REQ-000001",
    });
    // Unknown keys are simply ignored by a plain z.object(), not rejected —
    // this asserts they have no effect, i.e. they don't leak into parsed output.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("salaryMin");
      expect(result.data).not.toHaveProperty("hiringManagerUserId");
      expect(result.data).not.toHaveProperty("code");
    }
  });
});

describe("jobUpdateSchema", () => {
  it("requires a version", () => {
    expect(jobUpdateSchema.safeParse({ title: "New title" }).success).toBe(false);
  });

  it("accepts a partial update with only version", () => {
    expect(jobUpdateSchema.safeParse({ version: 0 }).success).toBe(true);
  });

  it("accepts clearing the target date and parent job via null", () => {
    const result = jobUpdateSchema.safeParse({ version: 0, targetDate: null, parentJobId: null });
    expect(result.success).toBe(true);
  });
});

describe("jobRecruitersUpdateSchema", () => {
  const base = { version: 0 };

  it("rejects zero primary recruiters", () => {
    const result = jobRecruitersUpdateSchema.safeParse({
      ...base,
      assignments: [{ userId: "a", isPrimary: false }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than one primary recruiter", () => {
    const result = jobRecruitersUpdateSchema.safeParse({
      ...base,
      assignments: [
        { userId: "a", isPrimary: true },
        { userId: "b", isPrimary: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a duplicate recruiter id", () => {
    const result = jobRecruitersUpdateSchema.safeParse({
      ...base,
      assignments: [
        { userId: "a", isPrimary: true },
        { userId: "a", isPrimary: false },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts exactly one primary among several recruiters", () => {
    const result = jobRecruitersUpdateSchema.safeParse({
      ...base,
      assignments: [
        { userId: "a", isPrimary: true },
        { userId: "b", isPrimary: false },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("jobStatusActionSchema", () => {
  it("requires a reasonId for HOLD, CLOSE, and CANCEL", () => {
    for (const action of ["HOLD", "CLOSE", "CANCEL"] as const) {
      expect(jobStatusActionSchema.safeParse({ action, version: 0 }).success).toBe(false);
      expect(
        jobStatusActionSchema.safeParse({ action, version: 0, reasonId: "reason-1" }).success,
      ).toBe(true);
    }
  });

  it("does not require a reasonId for SUBMIT, APPROVE, REJECT, or RESUME", () => {
    for (const action of ["SUBMIT", "APPROVE", "REJECT", "RESUME"] as const) {
      expect(jobStatusActionSchema.safeParse({ action, version: 0 }).success).toBe(true);
    }
  });

  it("rejects an unknown action", () => {
    expect(jobStatusActionSchema.safeParse({ action: "ARCHIVE", version: 0 }).success).toBe(false);
  });
});

describe("jobQuerySchema", () => {
  it("defaults page and pageSize", () => {
    const result = jobQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  it("rejects a pageSize above 100", () => {
    expect(jobQuerySchema.safeParse({ pageSize: 500 }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(jobQuerySchema.safeParse({ status: "ARCHIVED" }).success).toBe(false);
  });
});
