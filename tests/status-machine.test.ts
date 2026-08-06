import { describe, expect, it } from "vitest";

import { findTransition, getLegalActions, JOB_TRANSITIONS } from "@/lib/jobs/status-machine";

describe("job status machine", () => {
  it("has no duplicate (from, action) pairs", () => {
    const keys = JOB_TRANSITIONS.map((transition) => `${transition.from}:${transition.action}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("treats CLOSED and CANCELLED as terminal", () => {
    expect(getLegalActions("CLOSED")).toHaveLength(0);
    expect(getLegalActions("CANCELLED")).toHaveLength(0);
  });

  it("requires a reason for HOLD, CLOSE, and CANCEL only", () => {
    const reasonRequiredActions = JOB_TRANSITIONS.filter((t) => t.reasonRequired).map((t) => t.action);
    expect(new Set(reasonRequiredActions)).toEqual(new Set(["HOLD", "CLOSE", "CANCEL"]));
  });

  it("gates APPROVE/REJECT behind the APPROVE permission and hiring-manager-only ownership", () => {
    const approve = findTransition("PENDING_APPROVAL", "APPROVE");
    const reject = findTransition("PENDING_APPROVAL", "REJECT");
    expect(approve?.requiredAction).toBe("APPROVE");
    expect(approve?.approverOnly).toBe(true);
    expect(reject?.requiredAction).toBe("APPROVE");
    expect(reject?.approverOnly).toBe(true);
  });

  it("routes SUBMIT/HOLD/RESUME/CLOSE/CANCEL through UPDATE, not APPROVE", () => {
    for (const action of ["SUBMIT", "HOLD", "RESUME", "CLOSE", "CANCEL"] as const) {
      const transitions = JOB_TRANSITIONS.filter((t) => t.action === action);
      expect(transitions.every((t) => t.requiredAction === "UPDATE")).toBe(true);
    }
  });

  it("returns undefined for an illegal transition", () => {
    expect(findTransition("DRAFT", "CLOSE")).toBeUndefined();
    expect(findTransition("CLOSED", "RESUME")).toBeUndefined();
  });
});
