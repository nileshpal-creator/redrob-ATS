import { describe, expect, it } from "vitest";

import { approvalEntityTypeSchema, approvalStepConfigsReplaceSchema } from "@/lib/validations/approval";

describe("approvalEntityTypeSchema", () => {
  it("accepts JOB and OFFER", () => {
    expect(approvalEntityTypeSchema.safeParse("JOB").success).toBe(true);
    expect(approvalEntityTypeSchema.safeParse("OFFER").success).toBe(true);
  });

  it("rejects an unknown entity type", () => {
    expect(approvalEntityTypeSchema.safeParse("INTERVIEW").success).toBe(false);
  });
});

describe("approvalStepConfigsReplaceSchema", () => {
  it("accepts an empty steps array — no configured chain", () => {
    expect(approvalStepConfigsReplaceSchema.safeParse({ steps: [] }).success).toBe(true);
  });

  it("accepts a valid contiguous multi-step chain", () => {
    const result = approvalStepConfigsReplaceSchema.safeParse({
      steps: [
        { stepOrder: 1, name: "Hiring Manager", requiredRoleId: "r1" },
        { stepOrder: 2, name: "Finance", requiredRoleId: "r2" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects duplicate stepOrder values", () => {
    const result = approvalStepConfigsReplaceSchema.safeParse({
      steps: [
        { stepOrder: 1, name: "A", requiredRoleId: "r1" },
        { stepOrder: 1, name: "B", requiredRoleId: "r2" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-contiguous stepOrder sequence (a gap)", () => {
    const result = approvalStepConfigsReplaceSchema.safeParse({
      steps: [
        { stepOrder: 1, name: "A", requiredRoleId: "r1" },
        { stepOrder: 3, name: "B", requiredRoleId: "r2" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a sequence not starting at 1", () => {
    const result = approvalStepConfigsReplaceSchema.safeParse({
      steps: [{ stepOrder: 2, name: "A", requiredRoleId: "r1" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty step name or missing requiredRoleId", () => {
    expect(
      approvalStepConfigsReplaceSchema.safeParse({ steps: [{ stepOrder: 1, name: "", requiredRoleId: "r1" }] }).success,
    ).toBe(false);
    expect(
      approvalStepConfigsReplaceSchema.safeParse({ steps: [{ stepOrder: 1, name: "A", requiredRoleId: "" }] }).success,
    ).toBe(false);
  });

  it("rejects more than 10 steps", () => {
    const steps = Array.from({ length: 11 }, (_, index) => ({
      stepOrder: index + 1,
      name: `Step ${index + 1}`,
      requiredRoleId: "r1",
    }));
    expect(approvalStepConfigsReplaceSchema.safeParse({ steps }).success).toBe(false);
  });
});
