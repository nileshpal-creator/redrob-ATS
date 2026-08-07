import { describe, expect, it } from "vitest";

import { handoffAcknowledgeSchema, handoffQuerySchema, handoffRetrySchema } from "@/lib/validations/handoff";

describe("handoffRetrySchema", () => {
  it("requires an integer version and nothing else", () => {
    expect(handoffRetrySchema.safeParse({ version: 0 }).success).toBe(true);
    expect(handoffRetrySchema.safeParse({ version: 1.5 }).success).toBe(false);
    expect(handoffRetrySchema.safeParse({}).success).toBe(false);
  });
});

describe("handoffAcknowledgeSchema", () => {
  it("requires an outcome and version", () => {
    expect(handoffAcknowledgeSchema.safeParse({ version: 0, outcome: "ACCEPTED" }).success).toBe(true);
    expect(handoffAcknowledgeSchema.safeParse({ outcome: "ACCEPTED" }).success).toBe(false);
    expect(handoffAcknowledgeSchema.safeParse({ version: 0 }).success).toBe(false);
  });

  it("rejects an unknown outcome", () => {
    expect(handoffAcknowledgeSchema.safeParse({ version: 0, outcome: "DELIVERED" }).success).toBe(false);
  });

  it("requires exceptionReason when outcome is EXCEPTION but not for ACCEPTED", () => {
    expect(handoffAcknowledgeSchema.safeParse({ version: 0, outcome: "EXCEPTION" }).success).toBe(false);
    expect(
      handoffAcknowledgeSchema.safeParse({ version: 0, outcome: "EXCEPTION", exceptionReason: "" }).success,
    ).toBe(false);
    expect(
      handoffAcknowledgeSchema.safeParse({ version: 0, outcome: "EXCEPTION", exceptionReason: "Missing signed agreement" })
        .success,
    ).toBe(true);
    expect(handoffAcknowledgeSchema.safeParse({ version: 0, outcome: "ACCEPTED" }).success).toBe(true);
  });
});

describe("handoffQuerySchema", () => {
  it("defaults page and pageSize", () => {
    const result = handoffQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  it("coerces page/pageSize from query-string values", () => {
    const result = handoffQuerySchema.parse({ page: "2", pageSize: "10" });
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });

  it("caps pageSize at 100", () => {
    expect(handoffQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(handoffQuerySchema.safeParse({ status: "SHIPPED" }).success).toBe(false);
  });

  it("accepts applicationId and status filters", () => {
    const result = handoffQuerySchema.safeParse({ applicationId: "app-1", status: "DELIVERED" });
    expect(result.success).toBe(true);
  });
});
