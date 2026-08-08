import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/authz/authorize";
import { assertWritableFields, sanitizeForRead, sanitizeManyForRead } from "@/lib/authz/field-sanitizer";

describe("field-sanitizer", () => {
  describe("sanitizeForRead", () => {
    it("returns the object unchanged when no field access rules apply", () => {
      const data = { name: "Jane", currentCompensation: 100000 };
      expect(sanitizeForRead(data, {})).toBe(data);
    });

    it("removes a HIDDEN core field entirely, not just nulls it", () => {
      const data = { name: "Jane", currentCompensation: 100000 };
      const result = sanitizeForRead(data, { currentCompensation: "HIDDEN" });
      expect(result.name).toBe("Jane");
      expect("currentCompensation" in result).toBe(false);
    });

    it("leaves a READ field visible (READ is not HIDDEN)", () => {
      const data = { name: "Jane", expectedCompensation: 120000 };
      const result = sanitizeForRead(data, { expectedCompensation: "READ" });
      expect(result.expectedCompensation).toBe(120000);
    });

    it("leaves a WRITE field visible", () => {
      const data = { name: "Jane", location: "Remote" };
      const result = sanitizeForRead(data, { location: "WRITE" });
      expect(result.location).toBe("Remote");
    });

    it("removes a HIDDEN custom field key from customFields without touching sibling keys", () => {
      const data = { name: "Jane", customFields: { certifications: ["AWS"], notes: "ok" } };
      const result = sanitizeForRead(data, { "customFields.certifications": "HIDDEN" });
      expect("certifications" in (result.customFields as Record<string, unknown>)).toBe(false);
      expect((result.customFields as Record<string, unknown>).notes).toBe("ok");
    });

    it("does not mutate the original object", () => {
      const data = { name: "Jane", currentCompensation: 100000 };
      sanitizeForRead(data, { currentCompensation: "HIDDEN" });
      expect(data.currentCompensation).toBe(100000);
    });

    it("is a no-op when the HIDDEN field/key is absent from the data", () => {
      const data = { name: "Jane" };
      const result = sanitizeForRead(data, { currentCompensation: "HIDDEN", "customFields.foo": "HIDDEN" });
      expect(result).toEqual({ name: "Jane" });
    });
  });

  describe("sanitizeManyForRead", () => {
    it("applies the same rule across every row", () => {
      const rows = [
        { id: "a", currentCompensation: 1 },
        { id: "b", currentCompensation: 2 },
      ];
      const result = sanitizeManyForRead(rows, { currentCompensation: "HIDDEN" });
      expect(result.every((row) => !("currentCompensation" in row))).toBe(true);
    });

    it("returns the same array reference when there is nothing to restrict", () => {
      const rows = [{ id: "a" }];
      expect(sanitizeManyForRead(rows, {})).toBe(rows);
    });
  });

  describe("assertWritableFields", () => {
    it("allows writing a field with no FieldPermission row at all (unrestricted)", () => {
      expect(() => assertWritableFields({ name: "Jane" }, {})).not.toThrow();
    });

    it("throws ForbiddenError when writing a HIDDEN field", () => {
      expect(() =>
        assertWritableFields({ currentCompensation: 100000 }, { currentCompensation: "HIDDEN" }),
      ).toThrow(ForbiddenError);
    });

    it("throws ForbiddenError when writing a READ-only field", () => {
      expect(() =>
        assertWritableFields({ expectedCompensation: 120000 }, { expectedCompensation: "READ" }),
      ).toThrow(ForbiddenError);
    });

    it("allows writing a field explicitly marked WRITE", () => {
      expect(() => assertWritableFields({ location: "Remote" }, { location: "WRITE" })).not.toThrow();
    });

    it("does not throw when the restricted field is simply absent from the input", () => {
      expect(() => assertWritableFields({ name: "Jane" }, { currentCompensation: "HIDDEN" })).not.toThrow();
    });

    it("does not throw when the restricted field is present but undefined (not actually being set)", () => {
      expect(() =>
        assertWritableFields({ currentCompensation: undefined }, { currentCompensation: "HIDDEN" }),
      ).not.toThrow();
    });

    it("blocks a HIDDEN custom field key nested under customFields", () => {
      expect(() =>
        assertWritableFields(
          { customFields: { certifications: ["AWS"] } },
          { "customFields.certifications": "HIDDEN" },
        ),
      ).toThrow(ForbiddenError);
    });

    it("allows an unrestricted custom field key alongside a restricted one", () => {
      expect(() =>
        assertWritableFields(
          { customFields: { notes: "ok" } },
          { "customFields.certifications": "HIDDEN" },
        ),
      ).not.toThrow();
    });
  });
});
