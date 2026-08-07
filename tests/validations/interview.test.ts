import { describe, expect, it } from "vitest";

import {
  interviewCancelSchema,
  interviewCompleteSchema,
  interviewCreateSchema,
  interviewFeedbackCreateSchema,
  interviewFeedbackUpdateSchema,
  interviewQuerySchema,
  interviewUpdateSchema,
} from "@/lib/validations/interview";

describe("interviewCreateSchema", () => {
  const base = {
    applicationId: "app-1",
    roundName: "Technical Round 1",
    mode: "VIRTUAL",
    scheduledAt: "2026-09-01T10:00:00.000Z",
    panelistUserIds: ["user-1"],
  };

  it("accepts a minimal valid payload and defaults durationMinutes to undefined (service defaults it to 60)", () => {
    const result = interviewCreateSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.durationMinutes).toBeUndefined();
    }
  });

  it("coerces scheduledAt to a Date", () => {
    const result = interviewCreateSchema.parse(base);
    expect(result.scheduledAt).toBeInstanceOf(Date);
  });

  it("rejects a missing applicationId, roundName, mode, scheduledAt, or panelistUserIds", () => {
    expect(interviewCreateSchema.safeParse({ ...base, applicationId: undefined }).success).toBe(false);
    expect(interviewCreateSchema.safeParse({ ...base, roundName: "" }).success).toBe(false);
    expect(interviewCreateSchema.safeParse({ ...base, mode: "REMOTE" }).success).toBe(false);
    expect(interviewCreateSchema.safeParse({ ...base, scheduledAt: "not-a-date" }).success).toBe(false);
    expect(interviewCreateSchema.safeParse({ ...base, panelistUserIds: [] }).success).toBe(false);
  });

  it("accepts all three interview modes", () => {
    for (const mode of ["ONSITE", "VIRTUAL", "PHONE"]) {
      expect(interviewCreateSchema.safeParse({ ...base, mode }).success).toBe(true);
    }
  });

  it("rejects a durationMinutes outside 5-480", () => {
    expect(interviewCreateSchema.safeParse({ ...base, durationMinutes: 4 }).success).toBe(false);
    expect(interviewCreateSchema.safeParse({ ...base, durationMinutes: 481 }).success).toBe(false);
    expect(interviewCreateSchema.safeParse({ ...base, durationMinutes: 60 }).success).toBe(true);
  });

  it("accepts optional location, notes, and customFields", () => {
    const result = interviewCreateSchema.safeParse({
      ...base,
      location: "https://meet.example.com/abc",
      notes: "Bring laptop for pairing exercise.",
      customFields: { panel_lead: "true" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 20 panelists", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `user-${i}`);
    expect(interviewCreateSchema.safeParse({ ...base, panelistUserIds: tooMany }).success).toBe(false);
  });
});

describe("interviewUpdateSchema", () => {
  it("requires an integer version and nothing else", () => {
    expect(interviewUpdateSchema.safeParse({ version: 0 }).success).toBe(true);
    expect(interviewUpdateSchema.safeParse({ version: 1.5 }).success).toBe(false);
    expect(interviewUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("does not accept status or cancellationReasonId — those go through their own action endpoints", () => {
    const parsed = interviewUpdateSchema.parse({ version: 0, status: "CANCELLED", cancellationReasonId: "reason-1" });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("cancellationReasonId");
  });

  it("accepts a partial reschedule payload", () => {
    const result = interviewUpdateSchema.safeParse({ version: 0, scheduledAt: "2026-09-05T09:00:00.000Z" });
    expect(result.success).toBe(true);
  });

  it("accepts explicitly clearing location and notes via null", () => {
    const result = interviewUpdateSchema.safeParse({ version: 0, location: null, notes: null });
    expect(result.success).toBe(true);
  });

  it("accepts a full-set panelist replacement", () => {
    const result = interviewUpdateSchema.safeParse({ version: 0, panelistUserIds: ["user-1", "user-2"] });
    expect(result.success).toBe(true);
  });
});

describe("interviewCancelSchema", () => {
  it("requires version and reasonId", () => {
    expect(interviewCancelSchema.safeParse({ version: 0, reasonId: "reason-1" }).success).toBe(true);
    expect(interviewCancelSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(interviewCancelSchema.safeParse({ reasonId: "reason-1" }).success).toBe(false);
  });
});

describe("interviewCompleteSchema", () => {
  it("requires only version", () => {
    expect(interviewCompleteSchema.safeParse({ version: 0 }).success).toBe(true);
    expect(interviewCompleteSchema.safeParse({}).success).toBe(false);
  });

  it("accepts an optional note", () => {
    expect(interviewCompleteSchema.safeParse({ version: 0, note: "Went well." }).success).toBe(true);
  });
});

describe("interviewFeedbackCreateSchema", () => {
  it("requires a recommendation and accepts optional rating/comments", () => {
    expect(interviewFeedbackCreateSchema.safeParse({ recommendation: "YES" }).success).toBe(true);
    expect(interviewFeedbackCreateSchema.safeParse({}).success).toBe(false);
    expect(interviewFeedbackCreateSchema.safeParse({ recommendation: "MAYBE" }).success).toBe(false);
  });

  it("accepts all four recommendation values", () => {
    for (const recommendation of ["STRONG_YES", "YES", "NO", "STRONG_NO"]) {
      expect(interviewFeedbackCreateSchema.safeParse({ recommendation }).success).toBe(true);
    }
  });

  it("rejects a rating outside 1-5", () => {
    expect(interviewFeedbackCreateSchema.safeParse({ recommendation: "YES", rating: 0 }).success).toBe(false);
    expect(interviewFeedbackCreateSchema.safeParse({ recommendation: "YES", rating: 6 }).success).toBe(false);
    expect(interviewFeedbackCreateSchema.safeParse({ recommendation: "YES", rating: 5 }).success).toBe(true);
  });

  it("does not accept a version — creation has none yet", () => {
    const parsed = interviewFeedbackCreateSchema.parse({ recommendation: "YES", version: 3 });
    expect(parsed).not.toHaveProperty("version");
  });
});

describe("interviewFeedbackUpdateSchema", () => {
  it("requires an integer version", () => {
    expect(interviewFeedbackUpdateSchema.safeParse({ version: 0 }).success).toBe(true);
    expect(interviewFeedbackUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a partial update and nulling out rating/comments", () => {
    expect(interviewFeedbackUpdateSchema.safeParse({ version: 0, recommendation: "NO" }).success).toBe(true);
    expect(interviewFeedbackUpdateSchema.safeParse({ version: 0, rating: null, comments: null }).success).toBe(true);
  });
});

describe("interviewQuerySchema", () => {
  it("defaults page and pageSize", () => {
    const result = interviewQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  it("coerces page/pageSize from query-string values", () => {
    const result = interviewQuerySchema.parse({ page: "2", pageSize: "10" });
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });

  it("caps pageSize at 100", () => {
    expect(interviewQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(interviewQuerySchema.safeParse({ status: "IN_PROGRESS" }).success).toBe(false);
  });

  it("accepts applicationId, panelistUserId, and status filters", () => {
    const result = interviewQuerySchema.safeParse({
      applicationId: "app-1",
      panelistUserId: "user-1",
      status: "SCHEDULED",
    });
    expect(result.success).toBe(true);
  });
});
