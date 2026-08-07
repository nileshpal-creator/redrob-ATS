import { describe, expect, it } from "vitest";

import {
  applicationBulkEmailSchema,
  applicationBulkTransitionSchema,
  applicationCreateSchema,
  applicationDuplicateCheckSchema,
  applicationTransitionSchema,
  applicationUpdateSchema,
  pipelineStagesReplaceSchema,
} from "@/lib/validations/application";

describe("applicationCreateSchema", () => {
  it("accepts a minimal payload with only candidateId/jobId", () => {
    expect(applicationCreateSchema.safeParse({ candidateId: "cand-1", jobId: "job-1" }).success).toBe(true);
  });

  it("rejects a missing candidateId or jobId", () => {
    expect(applicationCreateSchema.safeParse({ jobId: "job-1" }).success).toBe(false);
    expect(applicationCreateSchema.safeParse({ candidateId: "cand-1" }).success).toBe(false);
  });

  it("accepts optional stageId, ownerId, and customFields", () => {
    const result = applicationCreateSchema.safeParse({
      candidateId: "cand-1",
      jobId: "job-1",
      stageId: "stage-1",
      ownerId: "user-1",
      customFields: { source_notes: "referred by Jane" },
    });
    expect(result.success).toBe(true);
  });
});

describe("applicationUpdateSchema", () => {
  it("requires an integer version", () => {
    expect(applicationUpdateSchema.safeParse({ version: 0 }).success).toBe(true);
    expect(applicationUpdateSchema.safeParse({ version: 1.5 }).success).toBe(false);
    expect(applicationUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("does not accept stageId or outcome — those go through applicationTransitionSchema", () => {
    const parsed = applicationUpdateSchema.parse({ version: 0, stageId: "stage-1", outcome: "REJECTED" });
    expect(parsed).not.toHaveProperty("stageId");
    expect(parsed).not.toHaveProperty("outcome");
  });
});

describe("applicationTransitionSchema (discriminated union)", () => {
  it("accepts a valid STAGE_MOVE", () => {
    const result = applicationTransitionSchema.safeParse({ action: "STAGE_MOVE", version: 0, toStageId: "stage-2" });
    expect(result.success).toBe(true);
  });

  it("rejects STAGE_MOVE without a toStageId", () => {
    expect(applicationTransitionSchema.safeParse({ action: "STAGE_MOVE", version: 0 }).success).toBe(false);
  });

  it("accepts a valid REJECT and WITHDRAW, each requiring a reasonId", () => {
    expect(
      applicationTransitionSchema.safeParse({ action: "REJECT", version: 0, reasonId: "reason-1" }).success,
    ).toBe(true);
    expect(
      applicationTransitionSchema.safeParse({ action: "WITHDRAW", version: 0, reasonId: "reason-1" }).success,
    ).toBe(true);
    expect(applicationTransitionSchema.safeParse({ action: "REJECT", version: 0 }).success).toBe(false);
    expect(applicationTransitionSchema.safeParse({ action: "WITHDRAW", version: 0 }).success).toBe(false);
  });

  it("strips a toStageId irrelevant to REJECT/WITHDRAW rather than erroring", () => {
    const parsed = applicationTransitionSchema.parse({
      action: "REJECT",
      version: 0,
      reasonId: "reason-1",
      toStageId: "should-be-ignored",
    });
    expect(parsed).not.toHaveProperty("toStageId");
  });

  it("rejects an unknown action", () => {
    expect(applicationTransitionSchema.safeParse({ action: "REOPEN", version: 0 }).success).toBe(false);
  });
});

describe("applicationBulkTransitionSchema", () => {
  const targets = [{ id: "app-1", version: 0 }, { id: "app-2", version: 1 }];

  it("accepts a valid bulk STAGE_MOVE", () => {
    expect(
      applicationBulkTransitionSchema.safeParse({ action: "STAGE_MOVE", applications: targets, toStageId: "stage-2" })
        .success,
    ).toBe(true);
  });

  it("requires at least one target application", () => {
    expect(
      applicationBulkTransitionSchema.safeParse({ action: "STAGE_MOVE", applications: [], toStageId: "stage-2" })
        .success,
    ).toBe(false);
  });

  it("caps targets at 500", () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => ({ id: `app-${i}`, version: 0 }));
    expect(
      applicationBulkTransitionSchema.safeParse({ action: "STAGE_MOVE", applications: tooMany, toStageId: "stage-2" })
        .success,
    ).toBe(false);
  });

  it("requires a reasonId for bulk REJECT/WITHDRAW", () => {
    expect(applicationBulkTransitionSchema.safeParse({ action: "REJECT", applications: targets }).success).toBe(
      false,
    );
  });
});

describe("applicationBulkEmailSchema", () => {
  it("accepts a valid payload", () => {
    const result = applicationBulkEmailSchema.safeParse({
      applicationIds: ["app-1", "app-2"],
      templateId: "template-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty applicationIds or a missing templateId", () => {
    expect(applicationBulkEmailSchema.safeParse({ applicationIds: [], templateId: "template-1" }).success).toBe(
      false,
    );
    expect(applicationBulkEmailSchema.safeParse({ applicationIds: ["app-1"] }).success).toBe(false);
    expect(applicationBulkEmailSchema.safeParse({ applicationIds: ["app-1"], templateId: "" }).success).toBe(false);
  });

  it("no longer accepts free-typed subject/body — §11.10 requires a template", () => {
    const parsed = applicationBulkEmailSchema.parse({ applicationIds: ["app-1"], templateId: "template-1" });
    expect(parsed).not.toHaveProperty("subject");
    expect(parsed).not.toHaveProperty("body");
  });
});

describe("pipelineStagesReplaceSchema", () => {
  it("accepts a valid ordered list of stages", () => {
    const result = pipelineStagesReplaceSchema.safeParse({
      stages: [{ name: "Applied" }, { id: "stage-1", name: "Screening" }],
    });
    expect(result.success).toBe(true);
  });

  it("requires at least one stage", () => {
    expect(pipelineStagesReplaceSchema.safeParse({ stages: [] }).success).toBe(false);
  });

  it("rejects duplicate stage names, case-insensitively", () => {
    expect(
      pipelineStagesReplaceSchema.safeParse({ stages: [{ name: "Screening" }, { name: "screening" }] }).success,
    ).toBe(false);
  });
});

describe("applicationDuplicateCheckSchema", () => {
  it("requires both candidateId and jobId", () => {
    expect(applicationDuplicateCheckSchema.safeParse({ candidateId: "cand-1", jobId: "job-1" }).success).toBe(true);
    expect(applicationDuplicateCheckSchema.safeParse({ candidateId: "cand-1" }).success).toBe(false);
    expect(applicationDuplicateCheckSchema.safeParse({ jobId: "job-1" }).success).toBe(false);
  });
});
