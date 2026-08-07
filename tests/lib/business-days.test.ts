import { describe, expect, it } from "vitest";

import { businessDaysBetween, type WorkingCalendar } from "@/lib/reporting/business-days";

const MON_FRI: WorkingCalendar = { workingDays: [1, 2, 3, 4, 5], holidayKeys: new Set() };

describe("businessDaysBetween", () => {
  it("counts only working days, skipping weekends", () => {
    // 2024-01-01 is a Monday; 2024-01-08 is the following Monday.
    const result = businessDaysBetween(new Date("2024-01-01T00:00:00Z"), new Date("2024-01-08T00:00:00Z"), MON_FRI);
    expect(result).toBe(5); // Jan 2, 3, 4, 5, 8 — Jan 6-7 (Sat/Sun) excluded.
  });

  it("returns 0 for the same calendar day", () => {
    expect(businessDaysBetween(new Date("2024-01-01T08:00:00Z"), new Date("2024-01-01T20:00:00Z"), MON_FRI)).toBe(0);
  });

  it("returns 0 when `to` is before `from`", () => {
    expect(businessDaysBetween(new Date("2024-01-08T00:00:00Z"), new Date("2024-01-01T00:00:00Z"), MON_FRI)).toBe(0);
  });

  it("counts a Friday-to-Monday gap as 1 business day", () => {
    // 2024-01-05 is a Friday; 2024-01-08 is the following Monday.
    expect(businessDaysBetween(new Date("2024-01-05T00:00:00Z"), new Date("2024-01-08T00:00:00Z"), MON_FRI)).toBe(1);
  });

  it("excludes a one-off holiday", () => {
    const calendar: WorkingCalendar = { workingDays: [1, 2, 3, 4, 5], holidayKeys: new Set(["2024-01-02"]) };
    // Without the holiday, Jan 1 -> Jan 3 would be 2 (Jan 2, Jan 3).
    expect(businessDaysBetween(new Date("2024-01-01T00:00:00Z"), new Date("2024-01-03T00:00:00Z"), calendar)).toBe(1);
  });

  it("excludes a recurring-yearly holiday regardless of year", () => {
    const calendar: WorkingCalendar = { workingDays: [1, 2, 3, 4, 5], holidayKeys: new Set(["*-01-02"]) };
    expect(businessDaysBetween(new Date("2024-01-01T00:00:00Z"), new Date("2024-01-03T00:00:00Z"), calendar)).toBe(1);
    expect(businessDaysBetween(new Date("2025-01-01T00:00:00Z"), new Date("2025-01-03T00:00:00Z"), calendar)).toBe(1);
  });

  it("respects a non-Mon-Fri working week", () => {
    // Sun-Thu working week (0-4), Fri/Sat off.
    const calendar: WorkingCalendar = { workingDays: [0, 1, 2, 3, 4], holidayKeys: new Set() };
    // 2024-01-04 is a Thursday; 2024-01-07 is the following Sunday.
    expect(businessDaysBetween(new Date("2024-01-04T00:00:00Z"), new Date("2024-01-07T00:00:00Z"), calendar)).toBe(1);
  });
});
