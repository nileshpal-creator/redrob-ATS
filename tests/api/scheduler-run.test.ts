import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/scheduler/run/route";

function requestWithAuth(authorizationHeader?: string) {
  const headers = new Headers();
  if (authorizationHeader) headers.set("authorization", authorizationHeader);
  return new Request("http://localhost/api/scheduler/run", { method: "POST", headers });
}

describe("POST /api/scheduler/run", () => {
  const originalSecret = process.env.SCHEDULER_SECRET;

  beforeEach(() => {
    process.env.SCHEDULER_SECRET = "test-scheduler-secret";
  });

  afterEach(() => {
    process.env.SCHEDULER_SECRET = originalSecret;
  });

  it("rejects a request with no Authorization header", async () => {
    const response = await POST(requestWithAuth());
    expect(response.status).toBe(401);
  });

  it("rejects a request with the wrong secret", async () => {
    const response = await POST(requestWithAuth("Bearer wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("rejects a non-Bearer Authorization scheme", async () => {
    const response = await POST(requestWithAuth("Basic dGVzdDp0ZXN0"));
    expect(response.status).toBe(401);
  });

  it("accepts a request with the correct secret and returns per-consumer results", async () => {
    const response = await POST(requestWithAuth("Bearer test-scheduler-secret"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.consumers)).toBe(true);
    expect(body.consumers).toHaveLength(3);
    expect(typeof body.durationMs).toBe("number");
  });

  it("records a SCHEDULER audit entry with no actor on a successful run", async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "SCHEDULER" } });

    const response = await POST(requestWithAuth("Bearer test-scheduler-secret"));
    expect(response.status).toBe(200);

    const entries = await prisma.auditLog.findMany({ where: { entityType: "SCHEDULER" } });
    expect(entries).toHaveLength(1);
    expect(entries[0].actorId).toBeNull();
    expect(entries[0].action).toBe("scheduler.run");

    await prisma.auditLog.deleteMany({ where: { entityType: "SCHEDULER" } });
  });

  it("never leaks the configured secret itself in a response or error body", async () => {
    const unauthorized = await POST(requestWithAuth("Bearer wrong-secret"));
    const unauthorizedBody = JSON.stringify(await unauthorized.json());
    expect(unauthorizedBody).not.toContain("test-scheduler-secret");

    const authorized = await POST(requestWithAuth("Bearer test-scheduler-secret"));
    const authorizedBody = JSON.stringify(await authorized.json());
    expect(authorizedBody).not.toContain("test-scheduler-secret");
  });
});
