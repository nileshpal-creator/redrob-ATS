import { describe, expect, it } from "vitest";

import { inboundApplicationSchema, jobPostingCreateSchema, referralCreateSchema } from "@/lib/validations/job-posting";

describe("jobPostingCreateSchema", () => {
  it("requires a non-empty sourceId", () => {
    expect(jobPostingCreateSchema.safeParse({ sourceId: "src-1" }).success).toBe(true);
    expect(jobPostingCreateSchema.safeParse({ sourceId: "" }).success).toBe(false);
    expect(jobPostingCreateSchema.safeParse({}).success).toBe(false);
  });
});

describe("inboundApplicationSchema", () => {
  it("requires name and a valid phone; email and note are optional", () => {
    expect(inboundApplicationSchema.safeParse({ name: "Jane Doe", phone: "+1 555-1234" }).success).toBe(true);
    expect(
      inboundApplicationSchema.safeParse({ name: "Jane Doe", phone: "+1 555-1234", email: "jane@example.com", note: "Strong CV" })
        .success,
    ).toBe(true);
  });

  it("rejects a missing name or an empty name", () => {
    expect(inboundApplicationSchema.safeParse({ phone: "+1 555-1234" }).success).toBe(false);
    expect(inboundApplicationSchema.safeParse({ name: "", phone: "+1 555-1234" }).success).toBe(false);
  });

  it("rejects an invalid phone number", () => {
    expect(inboundApplicationSchema.safeParse({ name: "Jane Doe", phone: "not-a-phone!!" }).success).toBe(false);
  });

  it("rejects an invalid email when provided", () => {
    expect(
      inboundApplicationSchema.safeParse({ name: "Jane Doe", phone: "+1 555-1234", email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("lowercases the email", () => {
    const result = inboundApplicationSchema.parse({ name: "Jane Doe", phone: "+1 555-1234", email: "Jane@Example.COM" });
    expect(result.email).toBe("jane@example.com");
  });
});

describe("referralCreateSchema", () => {
  it("requires jobId, name, and a valid phone", () => {
    expect(referralCreateSchema.safeParse({ jobId: "job-1", name: "Jane Doe", phone: "+1 555-1234" }).success).toBe(true);
    expect(referralCreateSchema.safeParse({ name: "Jane Doe", phone: "+1 555-1234" }).success).toBe(false);
    expect(referralCreateSchema.safeParse({ jobId: "job-1", phone: "+1 555-1234" }).success).toBe(false);
    expect(referralCreateSchema.safeParse({ jobId: "job-1", name: "Jane Doe" }).success).toBe(false);
  });

  it("rejects an invalid phone number", () => {
    expect(referralCreateSchema.safeParse({ jobId: "job-1", name: "Jane Doe", phone: "abc" }).success).toBe(false);
  });

  it("accepts an optional email and note", () => {
    const result = referralCreateSchema.safeParse({
      jobId: "job-1",
      name: "Jane Doe",
      phone: "+1 555-1234",
      email: "jane@example.com",
      note: "Worked together previously",
    });
    expect(result.success).toBe(true);
  });
});
