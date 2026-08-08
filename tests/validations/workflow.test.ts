import { describe, expect, it } from "vitest";

import {
  workflowActionSchema,
  workflowConditionSchema,
  workflowDefinitionCreateSchema,
  workflowDefinitionQuerySchema,
  workflowDefinitionUpdateSchema,
  workflowRollbackSchema,
  workflowTaskQuerySchema,
  workflowTriggerSchema,
} from "@/lib/validations/workflow";

describe("workflowTriggerSchema", () => {
  it("accepts each of the four trigger types with their own config shape", () => {
    expect(workflowTriggerSchema.safeParse({ type: "STAGE_CHANGE", config: { toStageId: "stage-1" } }).success).toBe(true);
    expect(workflowTriggerSchema.safeParse({ type: "FIELD_UPDATE", config: { fieldKey: "priority_flag" } }).success).toBe(true);
    expect(workflowTriggerSchema.safeParse({ type: "TIME_IN_STAGE", config: { stageId: "stage-1", days: 3 } }).success).toBe(true);
    expect(workflowTriggerSchema.safeParse({ type: "FORM_SUBMISSION", config: {} }).success).toBe(true);
  });

  it("rejects a trigger whose config doesn't match its type", () => {
    expect(workflowTriggerSchema.safeParse({ type: "STAGE_CHANGE", config: { fieldKey: "x" } }).success).toBe(false);
    expect(workflowTriggerSchema.safeParse({ type: "TIME_IN_STAGE", config: { stageId: "stage-1", days: -1 } }).success).toBe(false);
  });

  it("rejects an unknown trigger type", () => {
    expect(workflowTriggerSchema.safeParse({ type: "CRON", config: {} }).success).toBe(false);
  });
});

describe("workflowActionSchema", () => {
  it("accepts each of the five action types with their own required fields", () => {
    expect(workflowActionSchema.safeParse({ type: "SEND_EMAIL", templateId: "tmpl-1" }).success).toBe(true);
    expect(
      workflowActionSchema.safeParse({ type: "CREATE_TASK", title: "Follow up", assignedToId: "user-1" }).success,
    ).toBe(true);
    expect(workflowActionSchema.safeParse({ type: "CHANGE_FIELD", fieldKey: "priority_flag", value: "hot" }).success).toBe(
      true,
    );
    expect(workflowActionSchema.safeParse({ type: "REASSIGN_OWNER", userId: "user-1" }).success).toBe(true);
    expect(
      workflowActionSchema.safeParse({ type: "REQUEST_APPROVAL", title: "Approve offer", approverId: "user-1" }).success,
    ).toBe(true);
  });

  it("rejects CREATE_TASK/REQUEST_APPROVAL missing their required title", () => {
    expect(workflowActionSchema.safeParse({ type: "CREATE_TASK", title: "", assignedToId: "user-1" }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ type: "REQUEST_APPROVAL", title: "", approverId: "user-1" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown action type", () => {
    expect(workflowActionSchema.safeParse({ type: "PAGE_ONCALL" }).success).toBe(false);
  });
});

describe("workflowConditionSchema", () => {
  it("accepts each of the five operators", () => {
    for (const operator of ["EQUALS", "NOT_EQUALS", "GREATER_THAN", "LESS_THAN", "CONTAINS"]) {
      expect(workflowConditionSchema.safeParse({ field: "score", operator, value: "5" }).success).toBe(true);
    }
  });

  it("accepts a numeric value", () => {
    expect(workflowConditionSchema.safeParse({ field: "score", operator: "GREATER_THAN", value: 5 }).success).toBe(true);
  });

  it("rejects an unknown operator or empty field", () => {
    expect(workflowConditionSchema.safeParse({ field: "score", operator: "MATCHES_REGEX", value: "x" }).success).toBe(
      false,
    );
    expect(workflowConditionSchema.safeParse({ field: "", operator: "EQUALS", value: "x" }).success).toBe(false);
  });
});

describe("workflowDefinitionCreateSchema", () => {
  const base = {
    name: "Notify HM",
    trigger: { type: "FORM_SUBMISSION" as const, config: {} },
    conditions: [],
    actions: [{ type: "SEND_EMAIL" as const, templateId: "tmpl-1" }],
  };

  it("accepts a global workflow (no jobId) for a job-agnostic trigger", () => {
    expect(workflowDefinitionCreateSchema.safeParse(base).success).toBe(true);
  });

  it("requires at least one action", () => {
    expect(workflowDefinitionCreateSchema.safeParse({ ...base, actions: [] }).success).toBe(false);
  });

  it("defaults isActive to true", () => {
    const parsed = workflowDefinitionCreateSchema.parse(base);
    expect(parsed.isActive).toBe(true);
  });
});

describe("workflowDefinitionUpdateSchema", () => {
  it("accepts a metadata-only update (no trigger/conditions/actions)", () => {
    expect(workflowDefinitionUpdateSchema.safeParse({ version: 0, isActive: false }).success).toBe(true);
  });

  it("accepts trigger+conditions+actions supplied together", () => {
    expect(
      workflowDefinitionUpdateSchema.safeParse({
        version: 0,
        trigger: { type: "FORM_SUBMISSION", config: {} },
        conditions: [],
        actions: [{ type: "REASSIGN_OWNER", userId: "user-1" }],
      }).success,
    ).toBe(true);
  });

  it("rejects trigger supplied without conditions/actions — all-or-nothing", () => {
    expect(
      workflowDefinitionUpdateSchema.safeParse({
        version: 0,
        trigger: { type: "FORM_SUBMISSION", config: {} },
      }).success,
    ).toBe(false);
  });

  it("rejects actions supplied alone without trigger/conditions", () => {
    expect(
      workflowDefinitionUpdateSchema.safeParse({
        version: 0,
        actions: [{ type: "REASSIGN_OWNER", userId: "user-1" }],
      }).success,
    ).toBe(false);
  });
});

describe("workflowRollbackSchema", () => {
  it("requires version and targetVersionId", () => {
    expect(workflowRollbackSchema.safeParse({ version: 0, targetVersionId: "v1" }).success).toBe(true);
    expect(workflowRollbackSchema.safeParse({ version: 0 }).success).toBe(false);
  });
});

describe("workflowDefinitionQuerySchema", () => {
  it("parses the string 'true'/'false' as boolean, not truthiness", () => {
    expect(workflowDefinitionQuerySchema.parse({ isActive: "true" }).isActive).toBe(true);
    expect(workflowDefinitionQuerySchema.parse({ isActive: "false" }).isActive).toBe(false);
  });

  it("leaves isActive undefined when omitted", () => {
    expect(workflowDefinitionQuerySchema.parse({}).isActive).toBeUndefined();
  });
});

describe("workflowTaskQuerySchema", () => {
  it("accepts an empty query", () => {
    expect(workflowTaskQuerySchema.safeParse({}).success).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(workflowTaskQuerySchema.safeParse({ status: "CANCELLED" }).success).toBe(false);
  });
});
