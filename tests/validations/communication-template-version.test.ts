import { describe, expect, it } from "vitest";

import {
  communicationTemplateVersionCreateSchema,
  communicationTemplateVersionDecideSchema,
} from "@/lib/validations/communication-template-version";

describe("communication template version validations", () => {
  describe("communicationTemplateVersionCreateSchema", () => {
    it("defaults language to 'en'", () => {
      const parsed = communicationTemplateVersionCreateSchema.parse({ subject: "s", body: "b" });
      expect(parsed.language).toBe("en");
    });

    it("accepts an explicit language", () => {
      const parsed = communicationTemplateVersionCreateSchema.parse({ language: "fr", subject: "s", body: "b" });
      expect(parsed.language).toBe("fr");
    });

    it("rejects a single-character language code", () => {
      expect(() => communicationTemplateVersionCreateSchema.parse({ language: "f", subject: "s", body: "b" })).toThrow();
    });

    it("rejects an empty subject or body", () => {
      expect(() => communicationTemplateVersionCreateSchema.parse({ subject: "", body: "b" })).toThrow();
      expect(() => communicationTemplateVersionCreateSchema.parse({ subject: "s", body: "" })).toThrow();
    });
  });

  describe("communicationTemplateVersionDecideSchema", () => {
    it("accepts APPROVE and REJECT", () => {
      expect(communicationTemplateVersionDecideSchema.parse({ decision: "APPROVE" }).decision).toBe("APPROVE");
      expect(communicationTemplateVersionDecideSchema.parse({ decision: "REJECT" }).decision).toBe("REJECT");
    });

    it("rejects an unknown decision", () => {
      expect(() => communicationTemplateVersionDecideSchema.parse({ decision: "MAYBE" })).toThrow();
    });

    it("accepts optional comments", () => {
      const parsed = communicationTemplateVersionDecideSchema.parse({ decision: "REJECT", comments: "not ready" });
      expect(parsed.comments).toBe("not ready");
    });
  });
});
