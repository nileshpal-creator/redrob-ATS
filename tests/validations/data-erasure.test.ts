import { describe, expect, it } from "vitest";

import {
  dataErasureRequestCreateSchema,
  dataErasureRequestDecideSchema,
  dataErasureRequestQuerySchema,
} from "@/lib/validations/data-erasure";

describe("dataErasureRequestCreateSchema", () => {
  it("accepts a method with an optional reason", () => {
    const result = dataErasureRequestCreateSchema.parse({ method: "ANONYMIZE", reason: "Candidate asked to be forgotten." });
    expect(result.method).toBe("ANONYMIZE");
  });

  it("accepts a method with no reason", () => {
    const result = dataErasureRequestCreateSchema.parse({ method: "HARD_DELETE" });
    expect(result.reason).toBeUndefined();
  });

  it("rejects an unknown method", () => {
    expect(() => dataErasureRequestCreateSchema.parse({ method: "DELETE_FOREVER" })).toThrow();
  });
});

describe("dataErasureRequestDecideSchema", () => {
  it("accepts APPROVE/REJECT with optional notes", () => {
    expect(dataErasureRequestDecideSchema.parse({ decision: "APPROVE" }).decision).toBe("APPROVE");
    expect(dataErasureRequestDecideSchema.parse({ decision: "REJECT", decisionNotes: "no" }).decision).toBe("REJECT");
  });

  it("rejects an unknown decision", () => {
    expect(() => dataErasureRequestDecideSchema.parse({ decision: "MAYBE" })).toThrow();
  });
});

describe("dataErasureRequestQuerySchema", () => {
  it("defaults page/pageSize when omitted", () => {
    const result = dataErasureRequestQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  it("accepts an optional status filter", () => {
    expect(dataErasureRequestQuerySchema.parse({ status: "PENDING" }).status).toBe("PENDING");
  });
});
