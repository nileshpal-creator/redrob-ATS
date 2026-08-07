import { describe, expect, it } from "vitest";

import {
  offerCreateSchema,
  offerQuerySchema,
  offerTransitionSchema,
  offerUpdateSchema,
} from "@/lib/validations/offer";

describe("offerCreateSchema", () => {
  const base = {
    applicationId: "app-1",
    compensation: 95000,
  };

  it("accepts a minimal valid payload", () => {
    expect(offerCreateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a missing applicationId or compensation", () => {
    expect(offerCreateSchema.safeParse({ ...base, applicationId: undefined }).success).toBe(false);
    expect(offerCreateSchema.safeParse({ ...base, compensation: undefined }).success).toBe(false);
  });

  it("rejects a zero or negative compensation", () => {
    expect(offerCreateSchema.safeParse({ ...base, compensation: 0 }).success).toBe(false);
    expect(offerCreateSchema.safeParse({ ...base, compensation: -1 }).success).toBe(false);
  });

  it("coerces expectedJoiningDate to a Date", () => {
    const result = offerCreateSchema.parse({ ...base, expectedJoiningDate: "2026-09-01" });
    expect(result.expectedJoiningDate).toBeInstanceOf(Date);
  });

  it("accepts optional notes and customFields", () => {
    const result = offerCreateSchema.safeParse({
      ...base,
      notes: "Fast-track candidate.",
      customFields: { relocation_assistance: "true" },
    });
    expect(result.success).toBe(true);
  });
});

describe("offerUpdateSchema", () => {
  it("requires an integer version and nothing else", () => {
    expect(offerUpdateSchema.safeParse({ version: 0 }).success).toBe(true);
    expect(offerUpdateSchema.safeParse({ version: 1.5 }).success).toBe(false);
    expect(offerUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("does not accept status — that goes through the transition endpoint", () => {
    const parsed = offerUpdateSchema.parse({ version: 0, status: "APPROVED" });
    expect(parsed).not.toHaveProperty("status");
  });

  it("accepts a partial edit and explicitly clearing notes/joining date via null", () => {
    expect(offerUpdateSchema.safeParse({ version: 0, compensation: 100000 }).success).toBe(true);
    expect(
      offerUpdateSchema.safeParse({ version: 0, notes: null, expectedJoiningDate: null }).success,
    ).toBe(true);
  });

  it("rejects a zero or negative compensation", () => {
    expect(offerUpdateSchema.safeParse({ version: 0, compensation: 0 }).success).toBe(false);
  });
});

describe("offerTransitionSchema", () => {
  it("requires action and version", () => {
    expect(offerTransitionSchema.safeParse({ action: "SUBMIT", version: 0 }).success).toBe(true);
    expect(offerTransitionSchema.safeParse({ action: "SUBMIT" }).success).toBe(false);
    expect(offerTransitionSchema.safeParse({ version: 0 }).success).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(offerTransitionSchema.safeParse({ action: "SIGN", version: 0 }).success).toBe(false);
  });

  it("requires a reasonId for DECLINE and REVOKE but not for other actions", () => {
    expect(offerTransitionSchema.safeParse({ action: "DECLINE", version: 0 }).success).toBe(false);
    expect(offerTransitionSchema.safeParse({ action: "REVOKE", version: 0 }).success).toBe(false);
    expect(offerTransitionSchema.safeParse({ action: "DECLINE", version: 0, reasonId: "r1" }).success).toBe(true);
    expect(offerTransitionSchema.safeParse({ action: "REVOKE", version: 0, reasonId: "r1" }).success).toBe(true);
    expect(offerTransitionSchema.safeParse({ action: "APPROVE", version: 0 }).success).toBe(true);
    expect(offerTransitionSchema.safeParse({ action: "EXTEND", version: 0 }).success).toBe(true);
    expect(offerTransitionSchema.safeParse({ action: "ACCEPT", version: 0 }).success).toBe(true);
  });

  it("accepts an optional comments field", () => {
    expect(
      offerTransitionSchema.safeParse({ action: "APPROVE", version: 0, comments: "Looks good." }).success,
    ).toBe(true);
  });
});

describe("offerQuerySchema", () => {
  it("defaults page and pageSize", () => {
    const result = offerQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  it("coerces page/pageSize from query-string values", () => {
    const result = offerQuerySchema.parse({ page: "2", pageSize: "10" });
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });

  it("caps pageSize at 100", () => {
    expect(offerQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(offerQuerySchema.safeParse({ status: "SIGNED" }).success).toBe(false);
  });

  it("accepts applicationId and status filters", () => {
    const result = offerQuerySchema.safeParse({ applicationId: "app-1", status: "EXTENDED" });
    expect(result.success).toBe(true);
  });
});
