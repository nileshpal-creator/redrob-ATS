import { describe, expect, it } from "vitest";

import {
  communicationTemplateCreateSchema,
  communicationTemplateQuerySchema,
  communicationTemplateUpdateSchema,
} from "@/lib/validations/communication-template";

describe("communicationTemplateCreateSchema", () => {
  const base = {
    name: "Interview Invite",
    channel: "EMAIL" as const,
    subject: "Update on your application to {{job.title}}",
    body: "Hi {{candidate.name}}, ...",
    isActive: true,
  };

  it("accepts a valid payload", () => {
    expect(communicationTemplateCreateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a missing name, subject, or body", () => {
    expect(communicationTemplateCreateSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(communicationTemplateCreateSchema.safeParse({ ...base, subject: "" }).success).toBe(false);
    expect(communicationTemplateCreateSchema.safeParse({ ...base, body: "" }).success).toBe(false);
  });

  it("accepts SMS as a channel value even though nothing sends over it yet", () => {
    expect(communicationTemplateCreateSchema.safeParse({ ...base, channel: "SMS" }).success).toBe(true);
  });

  it("rejects an unknown channel", () => {
    expect(communicationTemplateCreateSchema.safeParse({ ...base, channel: "CARRIER_PIGEON" }).success).toBe(false);
  });

  it("rejects a name or subject over the length limit", () => {
    expect(communicationTemplateCreateSchema.safeParse({ ...base, name: "x".repeat(121) }).success).toBe(false);
    expect(communicationTemplateCreateSchema.safeParse({ ...base, subject: "x".repeat(201) }).success).toBe(false);
  });
});

describe("communicationTemplateUpdateSchema", () => {
  it("accepts a partial edit", () => {
    expect(communicationTemplateUpdateSchema.safeParse({ subject: "New subject" }).success).toBe(true);
    expect(communicationTemplateUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(communicationTemplateUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("does not accept name — that field is immutable once created", () => {
    const parsed = communicationTemplateUpdateSchema.parse({ name: "Renamed", subject: "x" });
    expect(parsed).not.toHaveProperty("name");
  });
});

describe("communicationTemplateQuerySchema", () => {
  it("accepts no filters", () => {
    const result = communicationTemplateQuerySchema.parse({});
    expect(result.channel).toBeUndefined();
    expect(result.isActive).toBeUndefined();
  });

  it("parses the string 'true' as boolean true and 'false' as boolean false", () => {
    expect(communicationTemplateQuerySchema.parse({ isActive: "true" }).isActive).toBe(true);
    expect(communicationTemplateQuerySchema.parse({ isActive: "false" }).isActive).toBe(false);
  });

  it("rejects an unknown channel", () => {
    expect(communicationTemplateQuerySchema.safeParse({ channel: "CARRIER_PIGEON" }).success).toBe(false);
  });
});
