import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractBearerToken, isValidSchedulerSecret } from "@/lib/scheduler/auth";

describe("extractBearerToken", () => {
  it("extracts the token from a Bearer header", () => {
    expect(extractBearerToken("Bearer my-secret-value")).toBe("my-secret-value");
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractBearerToken("bearer my-secret-value")).toBe("my-secret-value");
  });

  it("returns null for a missing header", () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("returns null for an empty header", () => {
    expect(extractBearerToken("")).toBeNull();
  });
});

describe("isValidSchedulerSecret", () => {
  const originalSecret = process.env.SCHEDULER_SECRET;

  beforeEach(() => {
    process.env.SCHEDULER_SECRET = "correct-secret-value";
  });

  afterEach(() => {
    process.env.SCHEDULER_SECRET = originalSecret;
  });

  it("accepts the correct secret", () => {
    expect(isValidSchedulerSecret("correct-secret-value")).toBe(true);
  });

  it("rejects an incorrect secret", () => {
    expect(isValidSchedulerSecret("wrong-secret-value")).toBe(false);
  });

  it("rejects a secret of a different length than the correct one", () => {
    expect(isValidSchedulerSecret("short")).toBe(false);
    expect(isValidSchedulerSecret("a-much-longer-incorrect-secret-value-than-expected")).toBe(false);
  });

  it("rejects a null/missing provided secret", () => {
    expect(isValidSchedulerSecret(null)).toBe(false);
  });

  it("rejects everything when SCHEDULER_SECRET is not configured", () => {
    delete process.env.SCHEDULER_SECRET;
    expect(isValidSchedulerSecret("anything")).toBe(false);
    expect(isValidSchedulerSecret("correct-secret-value")).toBe(false);
  });

  it("is exact — a prefix or suffix of the real secret does not match", () => {
    expect(isValidSchedulerSecret("correct-secret-val")).toBe(false);
    expect(isValidSchedulerSecret("correct-secret-value-extra")).toBe(false);
  });
});
