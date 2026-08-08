import { z } from "zod";

const CONDITION_OPERATORS = ["EQUALS", "NOT_EQUALS", "GREATER_THAN", "LESS_THAN", "CONTAINS"] as const;

/**
 * A condition list is evaluated as AND-only, matching §10.2's own literal
 * phrasing: "when [event] and [condition], then [action]" — no OR/grouping.
 * `field` is always an Application.customFields key (see the model comment
 * on WorkflowDefinitionVersion for why core lifecycle fields aren't
 * addressable here); existence/type of that key is checked against the
 * active CustomFieldDefinition rows in the service layer, not here — same
 * "structural shape in Zod, foreign-key/semantic checks in the service"
 * split every other module uses (e.g. Job's assertControlledListValue).
 */
export const workflowConditionSchema = z.object({
  field: z.string().trim().min(1),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string(), z.number()]),
});
export type WorkflowCondition = z.infer<typeof workflowConditionSchema>;

export const stageChangeTriggerConfigSchema = z.object({ toStageId: z.string().min(1) });
export const fieldUpdateTriggerConfigSchema = z.object({ fieldKey: z.string().min(1) });
export const timeInStageTriggerConfigSchema = z.object({ stageId: z.string().min(1), days: z.number().int().positive() });
export const formSubmissionTriggerConfigSchema = z.object({});

export const workflowTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("STAGE_CHANGE"), config: stageChangeTriggerConfigSchema }),
  z.object({ type: z.literal("FIELD_UPDATE"), config: fieldUpdateTriggerConfigSchema }),
  z.object({ type: z.literal("TIME_IN_STAGE"), config: timeInStageTriggerConfigSchema }),
  z.object({ type: z.literal("FORM_SUBMISSION"), config: formSubmissionTriggerConfigSchema }),
]);
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>;

/**
 * "Send templated email/notification" -> EMAIL only, this codebase's one
 * real channel (Module 8) — see the model comment on WorkflowActionType for
 * why there's no separate in-app notification action. CREATE_TASK and
 * REQUEST_APPROVAL both produce a WorkflowTask row (request-approval is a
 * task with an approve/reject outcome instead of a plain done/not-done
 * one) — assignedToId/approverId existence-as-an-active-user is checked in
 * the service layer, same split as conditions' `field` above.
 */
export const sendEmailActionSchema = z.object({ type: z.literal("SEND_EMAIL"), templateId: z.string().min(1) });
export const createTaskActionSchema = z.object({
  type: z.literal("CREATE_TASK"),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  assignedToId: z.string().min(1),
  dueInDays: z.number().int().positive().optional(),
});
export const changeFieldActionSchema = z.object({
  type: z.literal("CHANGE_FIELD"),
  fieldKey: z.string().min(1),
  value: z.unknown(),
});
export const reassignOwnerActionSchema = z.object({ type: z.literal("REASSIGN_OWNER"), userId: z.string().min(1) });
export const requestApprovalActionSchema = z.object({
  type: z.literal("REQUEST_APPROVAL"),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  approverId: z.string().min(1),
});

export const workflowActionSchema = z.discriminatedUnion("type", [
  sendEmailActionSchema,
  createTaskActionSchema,
  changeFieldActionSchema,
  reassignOwnerActionSchema,
  requestApprovalActionSchema,
]);
export type WorkflowAction = z.infer<typeof workflowActionSchema>;

export const workflowDefinitionCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  // null/omitted = applies to every job's pipeline (§10.2: "does not have to apply globally").
  jobId: z.string().min(1).optional().nullable(),
  isActive: z.boolean().default(true),
  trigger: workflowTriggerSchema,
  conditions: z.array(workflowConditionSchema).max(20).default([]),
  actions: z.array(workflowActionSchema).min(1, "At least one action is required").max(10),
});
export type WorkflowDefinitionCreateInput = z.infer<typeof workflowDefinitionCreateSchema>;

/**
 * `trigger`/`conditions`/`actions` are all-or-nothing: supplying any one of
 * them means "replace the active configuration," which the service turns
 * into a brand-new WorkflowDefinitionVersion row rather than an in-place
 * edit — see updateWorkflowDefinition in src/lib/services/workflows.ts.
 * `name`/`isActive` are plain metadata edits with no version implication.
 */
export const workflowDefinitionUpdateSchema = z
  .object({
    version: z.number().int(),
    name: z.string().trim().min(1).max(200).optional(),
    isActive: z.boolean().optional(),
    trigger: workflowTriggerSchema.optional(),
    conditions: z.array(workflowConditionSchema).max(20).optional(),
    actions: z.array(workflowActionSchema).min(1).max(10).optional(),
  })
  .superRefine((val, ctx) => {
    const configFieldsGiven = [val.trigger, val.conditions, val.actions].filter((field) => field !== undefined).length;
    if (configFieldsGiven > 0 && configFieldsGiven < 3) {
      ctx.addIssue({
        code: "custom",
        message: "trigger, conditions, and actions must be supplied together to save a new version",
      });
    }
  });
export type WorkflowDefinitionUpdateInput = z.infer<typeof workflowDefinitionUpdateSchema>;

export const workflowRollbackSchema = z.object({
  version: z.number().int(),
  targetVersionId: z.string().min(1),
});
export type WorkflowRollbackInput = z.infer<typeof workflowRollbackSchema>;

export const workflowDefinitionQuerySchema = z.object({
  jobId: z.string().optional(),
  // z.coerce.boolean() maps the *string* "false" to true — query params
  // always arrive as strings. Same explicit-string-match fix Module 8 used.
  isActive: z
    .string()
    .transform((value) => value === "true")
    .optional(),
});
export type WorkflowDefinitionQuery = z.infer<typeof workflowDefinitionQuerySchema>;

export const workflowTaskQuerySchema = z.object({
  applicationId: z.string().optional(),
  assignedToId: z.string().optional(),
  status: z.enum(["OPEN", "DONE", "APPROVED", "REJECTED"]).optional(),
});
export type WorkflowTaskQuery = z.infer<typeof workflowTaskQuerySchema>;
