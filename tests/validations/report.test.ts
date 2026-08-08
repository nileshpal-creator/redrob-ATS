import { describe, expect, it } from "vitest";

import {
  offerTatComplianceQuerySchema,
  pipelineFunnelQuerySchema,
  reportExportQuerySchema,
  savedReportCreateSchema,
  savedReportUpdateSchema,
} from "@/lib/validations/report";

describe("pipelineFunnelQuerySchema", () => {
  it("requires jobId", () => {
    expect(() => pipelineFunnelQuerySchema.parse({})).toThrow();
  });

  it("accepts a bare jobId with everything else optional", () => {
    const result = pipelineFunnelQuerySchema.parse({ jobId: "job1" });
    expect(result).toEqual({ jobId: "job1" });
  });

  it("coerces date-range strings to Date instances", () => {
    const result = pipelineFunnelQuerySchema.parse({ jobId: "job1", dateFrom: "2024-01-01", dateTo: "2024-01-31" });
    expect(result.dateFrom).toBeInstanceOf(Date);
    expect(result.dateTo).toBeInstanceOf(Date);
  });
});

describe("offerTatComplianceQuerySchema", () => {
  it("leaves tatThresholdDays undefined when omitted — getOfferTatComplianceReport falls back to the org setting", () => {
    expect(offerTatComplianceQuerySchema.parse({}).tatThresholdDays).toBeUndefined();
  });

  it("rejects a non-positive threshold", () => {
    expect(() => offerTatComplianceQuerySchema.parse({ tatThresholdDays: 0 })).toThrow();
    expect(() => offerTatComplianceQuerySchema.parse({ tatThresholdDays: -1 })).toThrow();
  });

  it("coerces a string query param to a number", () => {
    expect(offerTatComplianceQuerySchema.parse({ tatThresholdDays: "5" }).tatThresholdDays).toBe(5);
  });
});

describe("reportExportQuerySchema", () => {
  it("rejects an unknown reportType or format", () => {
    expect(() => reportExportQuerySchema.parse({ reportType: "NOPE", format: "XLSX" })).toThrow();
    expect(() => reportExportQuerySchema.parse({ reportType: "PIPELINE_FUNNEL", format: "NOPE" })).toThrow();
  });

  it("defaults filters to an empty object", () => {
    const result = reportExportQuerySchema.parse({ reportType: "PIPELINE_FUNNEL", format: "CSV" });
    expect(result.filters).toEqual({});
  });
});

describe("savedReportCreateSchema", () => {
  const base = { name: "Weekly Funnel", reportType: "PIPELINE_FUNNEL" as const };

  it("defaults scheduleFrequency to NONE and allows no recipients", () => {
    const result = savedReportCreateSchema.parse(base);
    expect(result.scheduleFrequency).toBe("NONE");
    expect(result.recipientEmails).toEqual([]);
  });

  it("rejects a schedule with no recipient emails", () => {
    expect(() => savedReportCreateSchema.parse({ ...base, scheduleFrequency: "DAILY" })).toThrow();
  });

  it("accepts a schedule with at least one recipient email", () => {
    const result = savedReportCreateSchema.parse({ ...base, scheduleFrequency: "DAILY", recipientEmails: ["a@x.com"] });
    expect(result.scheduleFrequency).toBe("DAILY");
  });

  it("rejects a malformed recipient email", () => {
    expect(() => savedReportCreateSchema.parse({ ...base, recipientEmails: ["not-an-email"] })).toThrow();
  });

  it("requires a non-empty name", () => {
    expect(() => savedReportCreateSchema.parse({ ...base, name: "" })).toThrow();
  });
});

describe("savedReportUpdateSchema", () => {
  it("requires version but makes every other field optional", () => {
    const result = savedReportUpdateSchema.parse({ version: 1 });
    expect(result).toEqual({ version: 1 });
  });

  it("rejects a non-integer version", () => {
    expect(() => savedReportUpdateSchema.parse({ version: 1.5 })).toThrow();
  });
});
