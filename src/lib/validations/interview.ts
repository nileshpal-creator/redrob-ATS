import { z } from "zod";

const noteField = z.string().trim().max(2000).optional();
const modeField = z.enum(["ONSITE", "VIRTUAL", "PHONE"]);
const panelistIds = z.array(z.string().min(1)).min(1, "Assign at least one interviewer").max(20);

export const interviewCreateSchema = z.object({
  applicationId: z.string().min(1, "Application is required"),
  roundName: z.string().trim().min(1, "Round name is required").max(200),
  mode: modeField,
  location: z.string().trim().max(500).optional(),
  scheduledAt: z.coerce.date(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  panelistUserIds: panelistIds,
  notes: noteField,
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type InterviewCreateInput = z.infer<typeof interviewCreateSchema>;

/**
 * Reschedule / edit-details — mirrors applicationUpdateSchema's shape.
 * status/cancellationReasonId are not accepted here: cancelling and
 * completing each go through their own dedicated action endpoint (below),
 * the same separation Application draws between a plain PATCH and its
 * transition endpoint.
 */
export const interviewUpdateSchema = z.object({
  version: z.number().int(),
  roundName: z.string().trim().min(1).max(200).optional(),
  mode: modeField.optional(),
  location: z.string().trim().max(500).nullable().optional(),
  scheduledAt: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  // Full-set replace, same convention as jobRecruitersUpdateSchema /
  // pipelineStagesReplaceSchema — omit to leave the panel unchanged.
  panelistUserIds: panelistIds.optional(),
  notes: noteField.nullable(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type InterviewUpdateInput = z.infer<typeof interviewUpdateSchema>;

export const interviewCancelSchema = z.object({
  version: z.number().int(),
  reasonId: z.string().min(1, "A reason is required"),
  note: noteField,
});
export type InterviewCancelInput = z.infer<typeof interviewCancelSchema>;

export const interviewCompleteSchema = z.object({
  version: z.number().int(),
  note: noteField,
});
export type InterviewCompleteInput = z.infer<typeof interviewCompleteSchema>;

export const interviewNoShowSchema = z.object({
  version: z.number().int(),
  note: noteField,
});
export type InterviewNoShowInput = z.infer<typeof interviewNoShowSchema>;

const recommendationField = z.enum(["STRONG_YES", "YES", "NO", "STRONG_NO"]);

export const interviewFeedbackCreateSchema = z.object({
  recommendation: recommendationField,
  rating: z.number().int().min(1).max(5).optional(),
  comments: z.string().trim().max(5000).optional(),
});
export type InterviewFeedbackCreateInput = z.infer<typeof interviewFeedbackCreateSchema>;

export const interviewFeedbackUpdateSchema = z.object({
  version: z.number().int(),
  recommendation: recommendationField.optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  comments: z.string().trim().max(5000).nullable().optional(),
});
export type InterviewFeedbackUpdateInput = z.infer<typeof interviewFeedbackUpdateSchema>;

export const interviewQuerySchema = z.object({
  applicationId: z.string().optional(),
  panelistUserId: z.string().optional(),
  // jobId/recruiterId/dateFrom/dateTo back the calendar view (§11.6): "filterable
  // by recruiter, team and job." Team has no separate selector — it falls out of
  // the caller's own TEAM-scoped RBAC grant, the same way it already does for
  // Jobs/Applications/Offers list views.
  jobId: z.string().optional(),
  recruiterId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type InterviewQuery = z.infer<typeof interviewQuerySchema>;
