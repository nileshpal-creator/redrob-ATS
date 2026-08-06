import { describe, expect, it } from "vitest";

import {
  candidateCreateSchema,
  candidateImportCommitSchema,
  candidateMergeSchema,
  candidateQuerySchema,
  candidateUpdateSchema,
} from "@/lib/validations/candidate";

const validCreate = {
  name: "Jane Doe",
  phone: "+1 555-123-4567",
  consentGivenAt: "2026-01-01T00:00:00Z",
};

describe("candidateCreateSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = candidateCreateSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(candidateCreateSchema.safeParse({ ...validCreate, name: "" }).success).toBe(false);
    expect(candidateCreateSchema.safeParse({ ...validCreate, name: "   " }).success).toBe(false);
  });

  it("rejects a malformed phone number", () => {
    expect(candidateCreateSchema.safeParse({ ...validCreate, phone: "abc" }).success).toBe(false);
  });

  it("requires consentGivenAt", () => {
    const withoutConsent = Object.fromEntries(
      Object.entries(validCreate).filter(([key]) => key !== "consentGivenAt"),
    );
    expect(candidateCreateSchema.safeParse(withoutConsent).success).toBe(false);
  });

  it("accepts an optional email but rejects a malformed one", () => {
    expect(candidateCreateSchema.safeParse({ ...validCreate, email: "jane@example.com" }).success).toBe(true);
    expect(candidateCreateSchema.safeParse({ ...validCreate, email: "not-an-email" }).success).toBe(false);
  });

  it("does not require email, location, or sourceId", () => {
    const result = candidateCreateSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  it("rejects negative compensation or notice period", () => {
    expect(candidateCreateSchema.safeParse({ ...validCreate, currentCompensation: -1 }).success).toBe(false);
    expect(candidateCreateSchema.safeParse({ ...validCreate, noticePeriodDays: -1 }).success).toBe(false);
  });

  it("deduplicates skills and tags", () => {
    const result = candidateCreateSchema.safeParse({
      ...validCreate,
      skills: ["SQL", "SQL", "Python"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills).toEqual(["SQL", "Python"]);
    }
  });

  it("validates experienceHistory entries", () => {
    const valid = candidateCreateSchema.safeParse({
      ...validCreate,
      experienceHistory: [{ company: "Acme", title: "Engineer", startDate: "2020-01-01" }],
    });
    expect(valid.success).toBe(true);

    const invalid = candidateCreateSchema.safeParse({
      ...validCreate,
      experienceHistory: [{ company: "", title: "Engineer", startDate: "2020-01-01" }],
    });
    expect(invalid.success).toBe(false);
  });

  it("does not accept a currency or salary-visibility field (out of PRD scope)", () => {
    const result = candidateCreateSchema.safeParse({ ...validCreate, currency: "USD", salaryVisible: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("currency");
      expect(result.data).not.toHaveProperty("salaryVisible");
    }
  });
});

describe("candidateUpdateSchema", () => {
  it("requires a version", () => {
    expect(candidateUpdateSchema.safeParse({ name: "New name" }).success).toBe(false);
  });

  it("accepts a partial update with only version", () => {
    expect(candidateUpdateSchema.safeParse({ version: 0 }).success).toBe(true);
  });

  it("accepts clearing optional fields via null", () => {
    const result = candidateUpdateSchema.safeParse({ version: 0, email: null, location: null, sourceId: null });
    expect(result.success).toBe(true);
  });
});

describe("candidateQuerySchema", () => {
  it("defaults page and pageSize", () => {
    const result = candidateQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  it("normalizes skills/tags to arrays regardless of single or multi value", () => {
    const single = candidateQuerySchema.parse({ skills: "SQL" });
    expect(single.skills).toEqual(["SQL"]);

    const multiple = candidateQuerySchema.parse({ skills: ["SQL", "Python"] });
    expect(multiple.skills).toEqual(["SQL", "Python"]);
  });

  it("rejects a pageSize above 100", () => {
    expect(candidateQuerySchema.safeParse({ pageSize: 500 }).success).toBe(false);
  });
});

describe("candidateMergeSchema", () => {
  it("requires sourceCandidateId and version", () => {
    expect(candidateMergeSchema.safeParse({ sourceCandidateId: "abc", version: 0 }).success).toBe(true);
    expect(candidateMergeSchema.safeParse({ version: 0 }).success).toBe(false);
  });
});

describe("candidateImportCommitSchema", () => {
  it("requires at least one row", () => {
    expect(candidateImportCommitSchema.safeParse({ rows: [] }).success).toBe(false);
  });

  it("validates every row against candidateCreateSchema", () => {
    const result = candidateImportCommitSchema.safeParse({ rows: [validCreate, { ...validCreate, phone: "invalid" }] });
    expect(result.success).toBe(false);
  });
});
