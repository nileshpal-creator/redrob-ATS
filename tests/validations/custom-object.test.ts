import { describe, expect, it } from "vitest";

import {
  customObjectRecordCreateSchema,
  customObjectRecordQuerySchema,
  customObjectRecordUpdateSchema,
  customObjectRelationCreateSchema,
} from "@/lib/validations/custom-object";

describe("customObjectRecordCreateSchema", () => {
  it("accepts a definitionId with a data blob", () => {
    const result = customObjectRecordCreateSchema.parse({ definitionId: "def1", data: { name: "Acme" } });
    expect(result).toEqual({ definitionId: "def1", data: { name: "Acme" } });
  });

  it("defaults data to an empty object when omitted", () => {
    const result = customObjectRecordCreateSchema.parse({ definitionId: "def1" });
    expect(result.data).toEqual({});
  });

  it("rejects a missing definitionId", () => {
    expect(() => customObjectRecordCreateSchema.parse({ data: {} })).toThrow();
  });
});

describe("customObjectRecordUpdateSchema", () => {
  it("requires data (full replace, not partial)", () => {
    expect(() => customObjectRecordUpdateSchema.parse({})).toThrow();
  });

  it("accepts a data blob", () => {
    const result = customObjectRecordUpdateSchema.parse({ data: { name: "New" } });
    expect(result.data).toEqual({ name: "New" });
  });
});

describe("customObjectRecordQuerySchema", () => {
  it("defaults page/pageSize when omitted", () => {
    const result = customObjectRecordQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  it("coerces page/pageSize from query-string values", () => {
    const result = customObjectRecordQuerySchema.parse({ page: "2", pageSize: "10" });
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });

  it("accepts optional definitionId/relatedEntityType/relatedEntityId filters", () => {
    const result = customObjectRecordQuerySchema.parse({
      definitionId: "def1",
      relatedEntityType: "CANDIDATE",
      relatedEntityId: "cand1",
    });
    expect(result.definitionId).toBe("def1");
    expect(result.relatedEntityType).toBe("CANDIDATE");
    expect(result.relatedEntityId).toBe("cand1");
  });

  it("rejects a pageSize above 100", () => {
    expect(() => customObjectRecordQuerySchema.parse({ pageSize: "500" })).toThrow();
  });
});

describe("customObjectRelationCreateSchema", () => {
  it("accepts a full relation payload", () => {
    const result = customObjectRelationCreateSchema.parse({
      recordId: "rec1",
      relatedEntityType: "CANDIDATE",
      relatedEntityId: "cand1",
    });
    expect(result).toEqual({ recordId: "rec1", relatedEntityType: "CANDIDATE", relatedEntityId: "cand1" });
  });

  it("rejects an empty recordId", () => {
    expect(() =>
      customObjectRelationCreateSchema.parse({ recordId: "", relatedEntityType: "CANDIDATE", relatedEntityId: "cand1" }),
    ).toThrow();
  });

  it("rejects a missing relatedEntityId", () => {
    expect(() =>
      customObjectRelationCreateSchema.parse({ recordId: "rec1", relatedEntityType: "CANDIDATE" }),
    ).toThrow();
  });
});
