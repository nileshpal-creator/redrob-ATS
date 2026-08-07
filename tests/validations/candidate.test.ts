import { describe, expect, it } from "vitest";

import {
  candidateCreateSchema,
  candidateDocumentUploadSchema,
  candidateDuplicateCheckSchema,
  candidateExportQuerySchema,
  candidateImportCommitSchema,
  candidateMergeSchema,
  candidateNoteSchema,
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

  it("rejects malformed phone numbers", () => {
    for (const phone of ["abc", "123", "555-CALL-NOW", "<script>alert(1)</script>", ""]) {
      expect(candidateCreateSchema.safeParse({ ...validCreate, phone }).success, `phone=${phone}`).toBe(false);
    }
  });

  it("accepts common real-world phone formats", () => {
    for (const phone of ["+1 555-123-4567", "(555) 123-4567", "5551234567", "+91 98765 43210"]) {
      expect(candidateCreateSchema.safeParse({ ...validCreate, phone }).success, `phone=${phone}`).toBe(true);
    }
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

  it("rejects a malformed consentGivenAt", () => {
    expect(candidateCreateSchema.safeParse({ ...validCreate, consentGivenAt: "not-a-date" }).success).toBe(false);
  });

  it("validates educationHistory entries", () => {
    const valid = candidateCreateSchema.safeParse({
      ...validCreate,
      educationHistory: [{ institution: "MIT", degree: "BSc" }],
    });
    expect(valid.success).toBe(true);

    const invalid = candidateCreateSchema.safeParse({
      ...validCreate,
      educationHistory: [{ institution: "", degree: "BSc" }],
    });
    expect(invalid.success).toBe(false);
  });

  it("rejects more than 50 skills or a single skill over 100 characters", () => {
    expect(
      candidateCreateSchema.safeParse({ ...validCreate, skills: Array.from({ length: 51 }, (_, i) => `skill-${i}`) })
        .success,
    ).toBe(false);
    expect(candidateCreateSchema.safeParse({ ...validCreate, skills: ["x".repeat(101)] }).success).toBe(false);
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

  it("rejects more than 500 rows", () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ ...validCreate, phone: `+1 555-000-${1000 + i}` }));
    expect(candidateImportCommitSchema.safeParse({ rows }).success).toBe(false);
  });
});

describe("candidateDocumentUploadSchema", () => {
  it("requires a documentTypeId", () => {
    expect(candidateDocumentUploadSchema.safeParse({}).success).toBe(false);
    expect(candidateDocumentUploadSchema.safeParse({ documentTypeId: "" }).success).toBe(false);
    expect(candidateDocumentUploadSchema.safeParse({ documentTypeId: "abc" }).success).toBe(true);
  });
});

describe("candidateDuplicateCheckSchema", () => {
  it("requires a phone; email is optional but must be valid if present", () => {
    expect(candidateDuplicateCheckSchema.safeParse({}).success).toBe(false);
    expect(candidateDuplicateCheckSchema.safeParse({ phone: "+1 555-0100" }).success).toBe(true);
    expect(candidateDuplicateCheckSchema.safeParse({ phone: "+1 555-0100", email: "not-an-email" }).success).toBe(
      false,
    );
  });
});

describe("candidateNoteSchema", () => {
  it("rejects an empty note body", () => {
    expect(candidateNoteSchema.safeParse({ body: "" }).success).toBe(false);
    expect(candidateNoteSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("rejects a note body over 5000 characters", () => {
    expect(candidateNoteSchema.safeParse({ body: "x".repeat(5001) }).success).toBe(false);
    expect(candidateNoteSchema.safeParse({ body: "x".repeat(5000) }).success).toBe(true);
  });
});

describe("candidateExportQuerySchema", () => {
  it("defaults format to csv and accepts xlsx", () => {
    expect(candidateExportQuerySchema.parse({}).format).toBe("csv");
    expect(candidateExportQuerySchema.parse({ format: "xlsx" }).format).toBe("xlsx");
  });

  it("rejects an unsupported format", () => {
    expect(candidateExportQuerySchema.safeParse({ format: "pdf" }).success).toBe(false);
  });
});
