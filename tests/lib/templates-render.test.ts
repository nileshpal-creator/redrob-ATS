import { describe, expect, it } from "vitest";

import { renderTemplate } from "@/lib/templates/render";

describe("renderTemplate", () => {
  it("substitutes plain {{key}} placeholders", () => {
    expect(renderTemplate("Hi {{candidate.name}}", { "candidate.name": "Ada" })).toBe("Hi Ada");
  });

  it("leaves an unknown placeholder as-is", () => {
    expect(renderTemplate("Hi {{unknown.key}}", {})).toBe("Hi {{unknown.key}}");
  });

  describe("conditional blocks", () => {
    it("includes a truthy-key block and drops it when falsy/missing", () => {
      const template = "Before {{#if vip}}VIP content{{/if}} After";
      expect(renderTemplate(template, { vip: "true" })).toBe("Before VIP content After");
      expect(renderTemplate(template, { vip: "false" })).toBe("Before  After");
      expect(renderTemplate(template, {})).toBe("Before  After");
    });

    it("supports an {{else}} branch", () => {
      const template = "{{#if vip}}VIP{{else}}Standard{{/if}}";
      expect(renderTemplate(template, { vip: "true" })).toBe("VIP");
      expect(renderTemplate(template, {})).toBe("Standard");
    });

    it("supports == and != comparisons", () => {
      const template = "{{#if status==OPEN}}Open now{{/if}}{{#if status!=OPEN}}Not open{{/if}}";
      expect(renderTemplate(template, { status: "OPEN" })).toBe("Open now");
      expect(renderTemplate(template, { status: "CLOSED" })).toBe("Not open");
    });

    it("still substitutes plain placeholders inside a surviving block", () => {
      const template = "{{#if job.title}}Role: {{job.title}}{{/if}}";
      expect(renderTemplate(template, { "job.title": "Engineer" })).toBe("Role: Engineer");
    });

    it("treats \"0\" as falsy, same as an empty/missing value", () => {
      expect(renderTemplate("{{#if count}}has count{{/if}}", { count: "0" })).toBe("");
    });
  });
});
