import { z } from "zod";

const REPORT_TYPES = ["PIPELINE_FUNNEL", "TIME_TO_FILL_AND_OFFER", "RECRUITER_PRODUCTIVITY", "OFFER_TAT_COMPLIANCE"] as const;
const EXPORT_FORMATS = ["XLSX", "CSV", "PDF"] as const;
const SCHEDULE_FREQUENCIES = ["NONE", "DAILY", "WEEKLY"] as const;

/** Shared by every report query — narrows the underlying record set by date range before aggregation. */
const dateRangeFields = {
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
};

export const pipelineFunnelQuerySchema = z.object({
  jobId: z.string().min(1, "Job is required"),
  recruiterId: z.string().optional(),
  sourceId: z.string().optional(),
  ...dateRangeFields,
});
export type PipelineFunnelQuery = z.infer<typeof pipelineFunnelQuerySchema>;

export const timeToFillOfferQuerySchema = z.object({
  departmentId: z.string().optional(),
  locationId: z.string().optional(),
  recruiterId: z.string().optional(),
  ...dateRangeFields,
});
export type TimeToFillOfferQuery = z.infer<typeof timeToFillOfferQuerySchema>;

export const recruiterProductivityQuerySchema = z.object({
  recruiterId: z.string().optional(),
  ...dateRangeFields,
});
export type RecruiterProductivityQuery = z.infer<typeof recruiterProductivityQuerySchema>;

export const offerTatComplianceQuerySchema = z.object({
  recruiterId: z.string().optional(),
  // Viewer-supplied compliance threshold, not a stored org policy — the PRD
  // names no fixed SLA number, so this stays a report parameter rather than
  // an invented Organization-level setting.
  tatThresholdDays: z.coerce.number().int().positive().default(3),
  ...dateRangeFields,
});
export type OfferTatComplianceQuery = z.infer<typeof offerTatComplianceQuerySchema>;

/** Which query schema each ReportType validates its `filters` against — used by both ad-hoc runs and SavedReport execution. */
export const REPORT_QUERY_SCHEMAS = {
  PIPELINE_FUNNEL: pipelineFunnelQuerySchema,
  TIME_TO_FILL_AND_OFFER: timeToFillOfferQuerySchema,
  RECRUITER_PRODUCTIVITY: recruiterProductivityQuerySchema,
  OFFER_TAT_COMPLIANCE: offerTatComplianceQuerySchema,
} as const;

export const reportExportQuerySchema = z.object({
  reportType: z.enum(REPORT_TYPES),
  format: z.enum(EXPORT_FORMATS),
  filters: z.record(z.string(), z.unknown()).default({}),
});
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;

export const savedReportCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    reportType: z.enum(REPORT_TYPES),
    filters: z.record(z.string(), z.unknown()).default({}),
    scheduleFrequency: z.enum(SCHEDULE_FREQUENCIES).default("NONE"),
    recipientEmails: z.array(z.string().email()).max(50).default([]),
    exportFormat: z.enum(EXPORT_FORMATS).default("XLSX"),
  })
  .superRefine((val, ctx) => {
    if (val.scheduleFrequency !== "NONE" && val.recipientEmails.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["recipientEmails"],
        message: "At least one recipient email is required when scheduling delivery",
      });
    }
  });
export type SavedReportCreateInput = z.infer<typeof savedReportCreateSchema>;

export const savedReportUpdateSchema = z.object({
  version: z.number().int(),
  name: z.string().trim().min(1).max(200).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  scheduleFrequency: z.enum(SCHEDULE_FREQUENCIES).optional(),
  recipientEmails: z.array(z.string().email()).max(50).optional(),
  exportFormat: z.enum(EXPORT_FORMATS).optional(),
});
export type SavedReportUpdateInput = z.infer<typeof savedReportUpdateSchema>;

export const savedReportQuerySchema = z.object({
  reportType: z.enum(REPORT_TYPES).optional(),
});
export type SavedReportQuery = z.infer<typeof savedReportQuerySchema>;
