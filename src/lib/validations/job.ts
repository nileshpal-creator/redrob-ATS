import { z } from "zod";

import { JOB_ACTIONS } from "@/lib/jobs/status-machine";

const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "TEMPORARY"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const JOB_STATUSES = ["DRAFT", "PENDING_APPROVAL", "OPEN", "ON_HOLD", "CLOSED", "CANCELLED"] as const;

/**
 * Fixed set for v1 rather than a ControlledList — unlike Department/Location,
 * an org's set of transacting currencies is rarely something recruiters need
 * to self-serve edit. Revisit as a ControlledList if that assumption breaks.
 */
export const CURRENCY_CODES = ["USD", "EUR", "GBP", "INR", "AUD", "CAD", "SGD", "AED"] as const;

const criteriaList = z
  .array(z.string().trim().min(1).max(300))
  .max(50)
  .default([])
  .transform((items) => Array.from(new Set(items)));

const salaryFields = {
  salaryMin: z.number().int().nonnegative().optional(),
  salaryMax: z.number().int().nonnegative().optional(),
  currency: z.enum(CURRENCY_CODES).optional(),
  salaryVisible: z.boolean().default(false),
};

function refineSalary(val: { salaryMin?: number; salaryMax?: number; currency?: string }, ctx: z.RefinementCtx) {
  if (val.salaryMin !== undefined && val.salaryMax !== undefined && val.salaryMin > val.salaryMax) {
    ctx.addIssue({ code: "custom", path: ["salaryMax"], message: "Max salary must be greater than or equal to min salary" });
  }
  if ((val.salaryMin !== undefined || val.salaryMax !== undefined) && !val.currency) {
    ctx.addIssue({ code: "custom", path: ["currency"], message: "Currency is required when a salary range is set" });
  }
}

export const jobCreateSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    departmentId: z.string().min(1, "Department is required"),
    locationId: z.string().min(1, "Location is required"),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    priority: z.enum(PRIORITIES),
    positionsCount: z.number().int().positive("Must be at least 1"),
    targetDate: z.coerce.date().optional(),
    description: z.string().max(20000).optional(),
    mustHaveCriteria: criteriaList,
    goodToHaveCriteria: criteriaList,
    ...salaryFields,
    parentJobId: z.string().optional(),
    recruiterUserIds: z.array(z.string()).min(1, "Assign at least one recruiter"),
    primaryRecruiterUserId: z.string().min(1, "Choose a primary recruiter"),
    hiringManagerUserId: z.string().min(1, "Hiring manager is required"),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((val, ctx) => {
    refineSalary(val, ctx);
    if (!val.recruiterUserIds.includes(val.primaryRecruiterUserId)) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryRecruiterUserId"],
        message: "Primary recruiter must be one of the assigned recruiters",
      });
    }
  });
export type JobCreateInput = z.infer<typeof jobCreateSchema>;

export const jobUpdateSchema = z
  .object({
    version: z.number().int(),
    title: z.string().trim().min(1).max(200).optional(),
    departmentId: z.string().min(1).optional(),
    locationId: z.string().min(1).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    positionsCount: z.number().int().positive().optional(),
    targetDate: z.coerce.date().optional().nullable(),
    description: z.string().max(20000).optional(),
    mustHaveCriteria: criteriaList.optional(),
    goodToHaveCriteria: criteriaList.optional(),
    salaryMin: salaryFields.salaryMin,
    salaryMax: salaryFields.salaryMax,
    currency: salaryFields.currency,
    salaryVisible: salaryFields.salaryVisible.optional(),
    parentJobId: z.string().optional().nullable(),
    hiringManagerUserId: z.string().min(1).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine(refineSalary);
export type JobUpdateInput = z.infer<typeof jobUpdateSchema>;

export const jobRecruitersUpdateSchema = z
  .object({
    version: z.number().int(),
    assignments: z
      .array(z.object({ userId: z.string().min(1), isPrimary: z.boolean() }))
      .min(1, "Assign at least one recruiter"),
  })
  .superRefine((val, ctx) => {
    const primaries = val.assignments.filter((assignment) => assignment.isPrimary);
    if (primaries.length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["assignments"],
        message: "Exactly one recruiter must be marked primary",
      });
    }
    const ids = val.assignments.map((assignment) => assignment.userId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["assignments"], message: "A recruiter is listed more than once" });
    }
  });
export type JobRecruitersUpdateInput = z.infer<typeof jobRecruitersUpdateSchema>;

export const jobStatusActionSchema = z
  .object({
    action: z.enum(JOB_ACTIONS),
    version: z.number().int(),
    reasonId: z.string().optional(),
    note: z.string().max(2000).optional(),
  })
  .superRefine((val, ctx) => {
    if (["HOLD", "CLOSE", "CANCEL"].includes(val.action) && !val.reasonId) {
      ctx.addIssue({ code: "custom", path: ["reasonId"], message: "A reason is required for this transition" });
    }
  });
export type JobStatusActionInput = z.infer<typeof jobStatusActionSchema>;

export const jobQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  departmentId: z.string().optional(),
  locationId: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  recruiterId: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type JobQuery = z.infer<typeof jobQuerySchema>;
