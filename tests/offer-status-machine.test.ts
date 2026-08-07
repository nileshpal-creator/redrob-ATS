import { describe, expect, it } from "vitest";

import { findTransition, getLegalActions, OFFER_TRANSITIONS } from "@/lib/offers/status-machine";

describe("offer status machine", () => {
  it("has no duplicate (from, action) pairs", () => {
    const keys = OFFER_TRANSITIONS.map((transition) => `${transition.from}:${transition.action}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("treats ACCEPTED, DECLINED, and REVOKED as terminal", () => {
    expect(getLegalActions("ACCEPTED")).toHaveLength(0);
    expect(getLegalActions("DECLINED")).toHaveLength(0);
    expect(getLegalActions("REVOKED")).toHaveLength(0);
  });

  it("requires a reason for DECLINE and REVOKE only", () => {
    const reasonRequiredActions = OFFER_TRANSITIONS.filter((t) => t.reasonRequired).map((t) => t.action);
    expect(new Set(reasonRequiredActions)).toEqual(new Set(["DECLINE", "REVOKE"]));
  });

  it("gates APPROVE/REJECT behind the APPROVE permission", () => {
    const approve = findTransition("PENDING_APPROVAL", "APPROVE");
    const reject = findTransition("PENDING_APPROVAL", "REJECT");
    expect(approve?.requiredAction).toBe("APPROVE");
    expect(reject?.requiredAction).toBe("APPROVE");
  });

  it("routes SUBMIT/EXTEND/ACCEPT/DECLINE/REVOKE through UPDATE, not APPROVE", () => {
    for (const action of ["SUBMIT", "EXTEND", "ACCEPT", "DECLINE", "REVOKE"] as const) {
      const transitions = OFFER_TRANSITIONS.filter((t) => t.action === action);
      expect(transitions.every((t) => t.requiredAction === "UPDATE")).toBe(true);
    }
  });

  it("returns undefined for an illegal transition", () => {
    expect(findTransition("DRAFT", "ACCEPT")).toBeUndefined();
    expect(findTransition("ACCEPTED", "REVOKE")).toBeUndefined();
  });

  it("allows REVOKE from every non-terminal status", () => {
    for (const status of ["DRAFT", "PENDING_APPROVAL", "APPROVED", "EXTENDED"] as const) {
      expect(findTransition(status, "REVOKE")).toBeDefined();
    }
  });
});
