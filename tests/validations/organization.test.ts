import { describe, expect, it } from "vitest";

import { organizationSettingsUpdateSchema } from "@/lib/validations/organization";

describe("organizationSettingsUpdateSchema", () => {
  it("rejects an empty payload — at least one setting must be provided", () => {
    expect(organizationSettingsUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts interviewReminderLeadMinutes alone", () => {
    const result = organizationSettingsUpdateSchema.safeParse({ interviewReminderLeadMinutes: [60, 1440] });
    expect(result.success).toBe(true);
  });

  it("accepts offerTatThresholdDays alone", () => {
    const result = organizationSettingsUpdateSchema.safeParse({ offerTatThresholdDays: 5 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interviewReminderLeadMinutes).toBeUndefined();
    }
  });

  it("accepts both fields together", () => {
    const result = organizationSettingsUpdateSchema.safeParse({
      interviewReminderLeadMinutes: [60],
      offerTatThresholdDays: 3,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive or non-integer offerTatThresholdDays", () => {
    expect(organizationSettingsUpdateSchema.safeParse({ offerTatThresholdDays: 0 }).success).toBe(false);
    expect(organizationSettingsUpdateSchema.safeParse({ offerTatThresholdDays: -1 }).success).toBe(false);
    expect(organizationSettingsUpdateSchema.safeParse({ offerTatThresholdDays: 1.5 }).success).toBe(false);
  });

  it("rejects an offerTatThresholdDays above the 90-day cap", () => {
    expect(organizationSettingsUpdateSchema.safeParse({ offerTatThresholdDays: 91 }).success).toBe(false);
    expect(organizationSettingsUpdateSchema.safeParse({ offerTatThresholdDays: 90 }).success).toBe(true);
  });

  it("coerces a string offerTatThresholdDays", () => {
    const result = organizationSettingsUpdateSchema.parse({ offerTatThresholdDays: "10" });
    expect(result.offerTatThresholdDays).toBe(10);
  });

  it("rejects duplicate interviewReminderLeadMinutes", () => {
    expect(organizationSettingsUpdateSchema.safeParse({ interviewReminderLeadMinutes: [60, 60] }).success).toBe(false);
  });
});
