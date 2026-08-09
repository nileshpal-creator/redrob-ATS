import { describe, expect, it } from "vitest";

import {
  dashboardCreateSchema,
  dashboardFilterSchema,
  dashboardUpdateSchema,
  dashboardWidgetCreateSchema,
  dashboardWidgetUpdateSchema,
} from "@/lib/validations/dashboard";

describe("dashboard validations", () => {
  describe("dashboardCreateSchema", () => {
    it("accepts a name-only input", () => {
      expect(dashboardCreateSchema.parse({ name: "My Dashboard" })).toEqual({ name: "My Dashboard" });
    });

    it("rejects an empty name", () => {
      expect(() => dashboardCreateSchema.parse({ name: "" })).toThrow();
    });
  });

  describe("dashboardUpdateSchema", () => {
    it("requires version", () => {
      expect(() => dashboardUpdateSchema.parse({ name: "x" })).toThrow();
    });

    it("accepts a partial update with version", () => {
      expect(dashboardUpdateSchema.parse({ version: 0, name: "New" })).toEqual({ version: 0, name: "New" });
    });
  });

  describe("dashboardFilterSchema", () => {
    it("accepts each supported operator", () => {
      for (const operator of ["EQUALS", "NOT_EQUALS", "GREATER_THAN", "LESS_THAN", "CONTAINS"]) {
        expect(() => dashboardFilterSchema.parse({ field: "status", operator, value: "OPEN" })).not.toThrow();
      }
    });

    it("rejects an unknown operator", () => {
      expect(() => dashboardFilterSchema.parse({ field: "status", operator: "STARTS_WITH", value: "x" })).toThrow();
    });

    it("accepts a numeric value", () => {
      expect(dashboardFilterSchema.parse({ field: "positionsCount", operator: "GREATER_THAN", value: 2 }).value).toBe(2);
    });
  });

  describe("dashboardWidgetCreateSchema", () => {
    it("defaults aggregate to COUNT and doesn't require fieldKey", () => {
      const parsed = dashboardWidgetCreateSchema.parse({ title: "Total Jobs", entityType: "JOB" });
      expect(parsed.aggregate).toBe("COUNT");
      expect(parsed.fieldKey).toBeUndefined();
      expect(parsed.filters).toEqual([]);
      expect(parsed.sortOrder).toBe(0);
    });

    it("requires fieldKey for a non-COUNT aggregate", () => {
      expect(() => dashboardWidgetCreateSchema.parse({ title: "Sum", entityType: "JOB", aggregate: "SUM" })).toThrow();
    });

    it("accepts a non-COUNT aggregate once fieldKey is supplied", () => {
      const parsed = dashboardWidgetCreateSchema.parse({
        title: "Sum",
        entityType: "JOB",
        aggregate: "SUM",
        fieldKey: "positionsCount",
      });
      expect(parsed.fieldKey).toBe("positionsCount");
    });

    it("caps filters at 10", () => {
      const filters = Array.from({ length: 11 }, (_, i) => ({ field: `f${i}`, operator: "EQUALS", value: "x" }));
      expect(() => dashboardWidgetCreateSchema.parse({ title: "T", entityType: "JOB", filters })).toThrow();
    });
  });

  describe("dashboardWidgetUpdateSchema", () => {
    it("allows explicitly clearing fieldKey/groupByKey via null", () => {
      const parsed = dashboardWidgetUpdateSchema.parse({ fieldKey: null, groupByKey: null });
      expect(parsed.fieldKey).toBeNull();
      expect(parsed.groupByKey).toBeNull();
    });

    it("allows a partial update with no fields at all", () => {
      expect(dashboardWidgetUpdateSchema.parse({})).toEqual({});
    });
  });
});
