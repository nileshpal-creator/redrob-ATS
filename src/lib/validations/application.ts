import { z } from "zod";

const noteField = z.string().trim().max(2000).optional();

export const applicationCreateSchema = z.object({
  candidateId: z.string().min(1, "Candidate is required"),
  jobId: z.string().min(1, "Job is required"),
  // Defaults resolved by the service when omitted: stageId to the job's
  // lowest-sortOrder active PipelineStage, ownerId to Job.primaryRecruiterId.
  stageId: z.string().optional(),
  ownerId: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type ApplicationCreateInput = z.infer<typeof applicationCreateSchema>;

// candidateId/jobId are immutable after creation (omitted here on purpose,
// same technique as Candidate's consentGivenAt); stageId/outcome go through
// applicationTransitionSchema instead, never through a plain update.
export const applicationUpdateSchema = z.object({
  version: z.number().int(),
  ownerId: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type ApplicationUpdateInput = z.infer<typeof applicationUpdateSchema>;

/**
 * Discriminated on `action`, mirroring jobStatusActionSchema's shape but as
 * a true discriminated union rather than a single object + superRefine —
 * STAGE_MOVE takes a `toStageId` and no `reasonId`; REJECT/WITHDRAW take a
 * `reasonId` and no `toStageId`. Rejected/Withdrawn are terminal outcomes
 * (Phase 2 decision), enforced here by there being no "REOPEN" member.
 */
export const applicationTransitionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("STAGE_MOVE"),
    version: z.number().int(),
    toStageId: z.string().min(1, "A target stage is required"),
    note: noteField,
  }),
  z.object({
    action: z.literal("REJECT"),
    version: z.number().int(),
    reasonId: z.string().min(1, "A reason is required"),
    note: noteField,
  }),
  z.object({
    action: z.literal("WITHDRAW"),
    version: z.number().int(),
    reasonId: z.string().min(1, "A reason is required"),
    note: noteField,
  }),
]);
export type ApplicationTransitionInput = z.infer<typeof applicationTransitionSchema>;

const bulkTargets = z
  .array(z.object({ id: z.string().min(1), version: z.number().int() }))
  .min(1, "Select at least one application")
  .max(500);

/** Same per-action shape as applicationTransitionSchema, applied to many applications at once. */
export const applicationBulkTransitionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("STAGE_MOVE"),
    applications: bulkTargets,
    toStageId: z.string().min(1, "A target stage is required"),
    note: noteField,
  }),
  z.object({
    action: z.literal("REJECT"),
    applications: bulkTargets,
    reasonId: z.string().min(1, "A reason is required"),
    note: noteField,
  }),
  z.object({
    action: z.literal("WITHDRAW"),
    applications: bulkTargets,
    reasonId: z.string().min(1, "A reason is required"),
    note: noteField,
  }),
]);
export type ApplicationBulkTransitionInput = z.infer<typeof applicationBulkTransitionSchema>;

/**
 * Infrastructure-only bulk email (Phase 2 decision): subject/body are
 * rendered server-side and logged, never sent — see
 * src/lib/services/applications.ts#bulkEmailApplications.
 */
export const applicationBulkEmailSchema = z.object({
  applicationIds: z.array(z.string().min(1)).min(1, "Select at least one application").max(500),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Body is required").max(10000),
});
export type ApplicationBulkEmailInput = z.infer<typeof applicationBulkEmailSchema>;

/**
 * Full-set replace, same convention as jobRecruitersUpdateSchema: the client
 * always PUTs the complete desired pipeline. Entries with no `id` are new
 * stages; existing stages omitted from the array are deactivated by the
 * service, never deleted — see replacePipelineStages.
 */
export const pipelineStagesReplaceSchema = z
  .object({
    stages: z
      .array(z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(100) }))
      .min(1, "A pipeline needs at least one stage"),
  })
  .superRefine((val, ctx) => {
    const names = val.stages.map((stage) => stage.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: "custom", path: ["stages"], message: "Stage names must be unique" });
    }
  });
export type PipelineStagesReplaceInput = z.infer<typeof pipelineStagesReplaceSchema>;

export const applicationDuplicateCheckSchema = z.object({
  candidateId: z.string().min(1, "Candidate is required"),
  jobId: z.string().min(1, "Job is required"),
});
export type ApplicationDuplicateCheckInput = z.infer<typeof applicationDuplicateCheckSchema>;

export const applicationQuerySchema = z.object({
  jobId: z.string().optional(),
  candidateId: z.string().optional(),
  stageId: z.string().optional(),
  outcome: z.enum(["ACTIVE", "REJECTED", "WITHDRAWN"]).optional(),
  ownerId: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ApplicationQuery = z.infer<typeof applicationQuerySchema>;
