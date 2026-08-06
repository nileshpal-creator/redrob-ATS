import { z } from "zod";

const PHONE_PATTERN = /^[0-9+\-() ]{7,20}$/;

const tagList = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .default([])
  .transform((items) => Array.from(new Set(items)));

const experienceEntrySchema = z.object({
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  description: z.string().max(2000).optional(),
});

const educationEntrySchema = z.object({
  institution: z.string().trim().min(1).max(200),
  degree: z.string().trim().min(1).max(200),
  fieldOfStudy: z.string().trim().max(200).optional(),
  startYear: z.number().int().optional(),
  endYear: z.number().int().optional(),
});

const experienceHistoryList = z.array(experienceEntrySchema).max(20).optional();
const educationHistoryList = z.array(educationEntrySchema).max(20).optional();

export const candidateCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z
    .string()
    .trim()
    .regex(PHONE_PATTERN, "Enter a valid phone number"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").optional(),
  location: z.string().trim().max(200).optional(),
  currentCompensation: z.number().nonnegative().optional(),
  expectedCompensation: z.number().nonnegative().optional(),
  noticePeriodDays: z.number().int().nonnegative().optional(),
  earliestAvailability: z.coerce.date().optional(),
  totalExperienceYears: z.number().nonnegative().optional(),
  skills: tagList,
  tags: tagList,
  experienceHistory: experienceHistoryList,
  educationHistory: educationHistoryList,
  sourceId: z.string().optional(),
  // GDPR-aligned consent capture (§13, §9) — creation is rejected without it.
  consentGivenAt: z.coerce.date(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type CandidateCreateInput = z.infer<typeof candidateCreateSchema>;

export const candidateUpdateSchema = z.object({
  version: z.number().int(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().regex(PHONE_PATTERN, "Enter a valid phone number").optional(),
  email: z.string().trim().toLowerCase().email().optional().nullable(),
  location: z.string().trim().max(200).optional().nullable(),
  currentCompensation: z.number().nonnegative().optional().nullable(),
  expectedCompensation: z.number().nonnegative().optional().nullable(),
  noticePeriodDays: z.number().int().nonnegative().optional().nullable(),
  earliestAvailability: z.coerce.date().optional().nullable(),
  totalExperienceYears: z.number().nonnegative().optional().nullable(),
  skills: tagList.optional(),
  tags: tagList.optional(),
  experienceHistory: experienceHistoryList,
  educationHistory: educationHistoryList,
  sourceId: z.string().optional().nullable(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type CandidateUpdateInput = z.infer<typeof candidateUpdateSchema>;

export const candidateQuerySchema = z.object({
  q: z.string().optional(),
  skills: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => (val === undefined ? undefined : Array.isArray(val) ? val : [val])),
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => (val === undefined ? undefined : Array.isArray(val) ? val : [val])),
  location: z.string().optional(),
  sourceId: z.string().optional(),
  noticePeriodMaxDays: z.coerce.number().int().nonnegative().optional(),
  experienceMinYears: z.coerce.number().nonnegative().optional(),
  experienceMaxYears: z.coerce.number().nonnegative().optional(),
  compensationMaxExpected: z.coerce.number().nonnegative().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CandidateQuery = z.infer<typeof candidateQuerySchema>;

export const candidateDuplicateCheckSchema = z.object({
  phone: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email().optional(),
});
export type CandidateDuplicateCheckInput = z.infer<typeof candidateDuplicateCheckSchema>;

export const candidateMergeSchema = z.object({
  sourceCandidateId: z.string().min(1),
  version: z.number().int(),
});
export type CandidateMergeInput = z.infer<typeof candidateMergeSchema>;

export const candidateDocumentUploadSchema = z.object({
  documentTypeId: z.string().min(1, "Document type is required"),
});
export type CandidateDocumentUploadInput = z.infer<typeof candidateDocumentUploadSchema>;

export const candidateNoteSchema = z.object({
  body: z.string().trim().min(1, "Note cannot be empty").max(5000),
});
export type CandidateNoteInput = z.infer<typeof candidateNoteSchema>;

export const candidateImportCommitSchema = z.object({
  rows: z.array(candidateCreateSchema).min(1).max(500),
});
export type CandidateImportCommitInput = z.infer<typeof candidateImportCommitSchema>;

export const candidateExportQuerySchema = candidateQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({
    format: z.enum(["csv", "xlsx"]).default("csv"),
  });
export type CandidateExportQuery = z.infer<typeof candidateExportQuerySchema>;
