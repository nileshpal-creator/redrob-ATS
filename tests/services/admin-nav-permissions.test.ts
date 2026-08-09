import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { SessionContext } from "@/lib/authz/session-context";
import { ForbiddenError } from "@/lib/authz/authorize";
import { ADMIN_NAV_PERMISSIONS, canAccessAdminNavItem } from "@/lib/authz/admin-nav-permissions";
import { adminNav } from "@/config/nav";
import { listUsers } from "@/lib/services/users";
import { listRoles } from "@/lib/services/roles";
import { listCustomFieldDefinitions } from "@/lib/services/custom-fields";
import { listCustomObjectDefinitions } from "@/lib/services/custom-objects";
import { listCommunicationTemplates } from "@/lib/services/communication-templates";
import { getOrganizationSettings } from "@/lib/services/organization";
import { listAuditLogs } from "@/lib/services/audit-log";
import { auditLogQuerySchema } from "@/lib/validations/audit-log";
import { listApprovalStepConfigs } from "@/lib/services/approvals";

function contextFor(user: {
  id: string;
  name: string;
  email: string;
  roles: { id: string; name: string; isSuperAdmin: boolean }[];
}): SessionContext {
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    roles: user.roles,
    isSuperAdmin: user.roles.some((role) => role.isSuperAdmin),
  };
}

/**
 * For each admin nav item, exactly what its own page.tsx calls to render
 * its core data (guardPage's own resource/action already lives in
 * ADMIN_NAV_PERMISSIONS — this is only the follow-up service call so the
 * test can assert it doesn't reject for a context holding exactly that nav
 * item's grant and nothing else).
 */
const CORE_PAGE_CALLS: Record<string, (context: SessionContext) => Promise<unknown>> = {
  "/admin/users": (context) => listUsers(context),
  "/admin/roles": (context) => listRoles(context),
  "/admin/custom-fields": (context) => listCustomFieldDefinitions(context),
  "/admin/communication-templates": (context) => listCommunicationTemplates(context, {}),
  "/admin/interview-reminders": (context) => getOrganizationSettings(context),
  "/admin/offer-settings": (context) => getOrganizationSettings(context),
  "/admin/approval-chains": (context) => listApprovalStepConfigs(context, "JOB"),
  "/admin/data-retention": (context) => getOrganizationSettings(context),
  "/admin/audit-log": (context) => listAuditLogs(context, auditLogQuerySchema.parse({})),
};

/**
 * listCustomFieldDefinitions and listCommunicationTemplates don't enforce
 * RBAC themselves — those two pages rely solely on their own page.tsx's
 * guardPage call (a Next.js redirect, not testable outside the Next.js
 * runtime). Every other CORE_PAGE_CALLS entry does its own
 * requirePermission/getEffectiveScope check and rejects with ForbiddenError
 * on its own, independent of any page. The "no grant → forbidden" test below
 * only applies to this second group.
 */
const PAGE_ONLY_ENFORCED_HREFS = new Set(["/admin/custom-fields", "/admin/communication-templates"]);
const CORE_CALL_SELF_ENFORCES = new Set(
  Object.keys(CORE_PAGE_CALLS).filter((href) => !PAGE_ONLY_ENFORCED_HREFS.has(href)),
);

describe("Admin nav permission mapping (ADMIN_NAV_PERMISSIONS)", () => {
  it("has an entry for every item in the admin sidebar's nav config", () => {
    for (const item of adminNav) {
      expect(ADMIN_NAV_PERMISSIONS[item.href], `missing ADMIN_NAV_PERMISSIONS entry for ${item.href}`).toBeDefined();
    }
  });

  it("has a CORE_PAGE_CALLS fixture for every ADMIN_NAV_PERMISSIONS entry (test-completeness check)", () => {
    for (const href of Object.keys(ADMIN_NAV_PERMISSIONS)) {
      expect(CORE_PAGE_CALLS[href], `missing CORE_PAGE_CALLS fixture for ${href}`).toBeDefined();
    }
  });
});

describe("Admin nav permission mapping — grant-per-item matches page access (regression for the Recruiter Users crash)", () => {
  let organizationId: string;
  let organizationPreExisted: boolean;

  const roleIds: string[] = [];
  const userEmails: string[] = [];

  // One role per ADMIN_NAV_PERMISSIONS entry, granted EXACTLY that entry's
  // resource/action (the "anyOf" approval-chains entry is tested via its
  // first alternative, JOB:READ, since either alone must be sufficient).
  const contextByHref: Record<string, SessionContext> = {};
  let noAccessContext: SessionContext;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const existingOrg = await prisma.organization.findFirst();
    organizationPreExisted = existingOrg !== null;
    organizationId = existingOrg ? existingOrg.id : (await prisma.organization.create({ data: { name: "Test Org" } })).id;

    const entries = Object.entries(ADMIN_NAV_PERMISSIONS);
    for (const [href, permission] of entries) {
      const grant = "anyOf" in permission ? permission.anyOf[0] : permission;
      const roleName = `Test Admin Nav ${href}`;
      const email = `admin-nav${href.replace(/\W+/g, "-")}@test.local`;

      const role = await prisma.role.create({
        data: {
          name: roleName,
          rolePermissions: { createMany: { data: [{ resource: grant.resource, action: grant.action, scope: "ALL" }] } },
        },
      });
      roleIds.push(role.id);

      const user = await prisma.user.create({ data: { name: roleName, email, passwordHash } });
      userEmails.push(email);
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

      contextByHref[href] = contextFor({ ...user, roles: [{ id: role.id, name: roleName, isSuperAdmin: false }] });
    }

    const noAccessRole = await prisma.role.create({ data: { name: "Test Admin Nav No Access" } });
    roleIds.push(noAccessRole.id);
    const noAccessUser = await prisma.user.create({
      data: { name: "No Access", email: "admin-nav-no-access@test.local", passwordHash },
    });
    userEmails.push("admin-nav-no-access@test.local");
    await prisma.userRole.create({ data: { userId: noAccessUser.id, roleId: noAccessRole.id } });
    noAccessContext = contextFor({
      ...noAccessUser,
      roles: [{ id: noAccessRole.id, name: "Test Admin Nav No Access", isSuperAdmin: false }],
    });
  });

  afterAll(async () => {
    if (!organizationPreExisted) {
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await prisma.userRole.deleteMany({ where: { roleId: { in: roleIds } } });
    await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  });

  for (const href of Object.keys(ADMIN_NAV_PERMISSIONS)) {
    it(`${href}: the exact grant that shows this nav item is sufficient to load its page`, async () => {
      const context = contextByHref[href];

      expect(await canAccessAdminNavItem(context, href)).toBe(true);
      await expect(CORE_PAGE_CALLS[href](context)).resolves.toBeDefined();
    });
  }

  it("a user with none of these grants sees no admin nav items at all", async () => {
    for (const href of Object.keys(ADMIN_NAV_PERMISSIONS)) {
      expect(await canAccessAdminNavItem(noAccessContext, href)).toBe(false);
    }
  });

  it("every self-enforcing core call independently rejects a no-grant context (defense in depth beyond the page guard)", async () => {
    for (const href of CORE_CALL_SELF_ENFORCES) {
      await expect(CORE_PAGE_CALLS[href](noAccessContext)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("custom-fields and communication-templates enforce nothing below the page guard — guardPage is the only gate", async () => {
    // Documents real, current behavior rather than asserting a preference:
    // these two services never checked permissions themselves (see
    // listCustomFieldDefinitions/listCommunicationTemplates), relying
    // entirely on their page.tsx's own guardPage call. A no-grant context
    // calling them directly succeeds — only reachable in practice through
    // the page, which does gate it.
    for (const href of PAGE_ONLY_ENFORCED_HREFS) {
      await expect(CORE_PAGE_CALLS[href](noAccessContext)).resolves.toBeDefined();
    }
  });

  it("/admin/custom-fields: CUSTOM_FIELD_DEFINITION:READ alone still hits a real ForbiddenError from listCustomObjectDefinitions (needs CUSTOM_OBJECT_DEFINITION:READ) — the page degrades this via .catch(() => [])", async () => {
    const context = contextByHref["/admin/custom-fields"];
    await expect(listCustomObjectDefinitions(context)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCustomObjectDefinitions(context).catch(() => [])).resolves.toEqual([]);
  });

  it("/admin/approval-chains: the anyOf condition's second alternative (OFFER:READ alone, no JOB:READ) is independently sufficient", async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);
    const offerOnlyRole = await prisma.role.create({
      data: {
        name: "Test Admin Nav Approval Chains Offer Only",
        rolePermissions: { createMany: { data: [{ resource: "OFFER", action: "READ", scope: "ALL" }] } },
      },
    });
    const offerOnlyUser = await prisma.user.create({
      data: { name: "Offer Only", email: "admin-nav-approval-chains-offer-only@test.local", passwordHash },
    });
    await prisma.userRole.create({ data: { userId: offerOnlyUser.id, roleId: offerOnlyRole.id } });
    const offerOnlyContext = contextFor({
      ...offerOnlyUser,
      roles: [{ id: offerOnlyRole.id, name: offerOnlyRole.name, isSuperAdmin: false }],
    });

    expect(await canAccessAdminNavItem(offerOnlyContext, "/admin/approval-chains")).toBe(true);
    await expect(listApprovalStepConfigs(offerOnlyContext, "OFFER")).resolves.toBeDefined();
    // No JOB grant at all — the OR condition must not require both.
    await expect(listApprovalStepConfigs(offerOnlyContext, "JOB")).rejects.toBeInstanceOf(ForbiddenError);

    await prisma.userRole.deleteMany({ where: { roleId: offerOnlyRole.id } });
    await prisma.user.delete({ where: { id: offerOnlyUser.id } });
    await prisma.role.delete({ where: { id: offerOnlyRole.id } });
  });
});

/**
 * The actual bug report: opening /admin/users as a Recruiter threw
 * ForbiddenError, even though the sidebar showed the link (Recruiter gets
 * USER:READ by default — prisma/seed.ts's DIRECTORY_ROLE_PERMISSIONS, so
 * recruiters can see a directory of colleagues to assign). The page also
 * unconditionally called listRoles (needs ROLE:READ, which Recruiter never
 * gets by default) to populate the Add User dialog's role picker — a
 * second, different permission than the one that made the link visible.
 *
 * This grant set is hand-copied from prisma/seed.ts's real Recruiter
 * defaults (JOB + USER, nothing admin-related) rather than imported, same
 * "keep in sync by hand, on purpose" convention as
 * tests/services/candidates.service.test.ts's own role-permission-matrix
 * block — if seed.ts's Recruiter grants change, update this fixture too.
 */
describe("Admin nav permission mapping — real Recruiter default grants", () => {
  let recruiterRoleId: string;
  let recruiter: SessionContext;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash("Test123!Test123!", 4);

    const recruiterRole = await prisma.role.create({
      data: {
        name: "Test Real Recruiter",
        rolePermissions: {
          createMany: {
            data: [
              { resource: "JOB", action: "CREATE", scope: "ALL" },
              { resource: "JOB", action: "READ", scope: "ALL" },
              { resource: "JOB", action: "UPDATE", scope: "OWN" },
              { resource: "USER", action: "READ", scope: "ALL" },
            ],
          },
        },
      },
    });
    recruiterRoleId = recruiterRole.id;

    const recruiterUser = await prisma.user.create({
      data: { name: "Real Recruiter", email: "real-recruiter-nav@test.local", passwordHash },
    });
    await prisma.userRole.create({ data: { userId: recruiterUser.id, roleId: recruiterRoleId } });

    recruiter = contextFor({
      ...recruiterUser,
      roles: [{ id: recruiterRoleId, name: "Test Real Recruiter", isSuperAdmin: false }],
    });
  });

  afterAll(async () => {
    await prisma.userRole.deleteMany({ where: { roleId: recruiterRoleId } });
    await prisma.user.deleteMany({ where: { email: "real-recruiter-nav@test.local" } });
    await prisma.role.deleteMany({ where: { id: recruiterRoleId } });
  });

  it("sees the Users nav item and successfully loads it, including a degraded (not crashed) role picker", async () => {
    expect(await canAccessAdminNavItem(recruiter, "/admin/users")).toBe(true);

    await expect(listUsers(recruiter)).resolves.toBeDefined();
    // The page itself wraps this in .catch(() => []) — asserting the
    // underlying call still rejects (Recruiter genuinely lacks ROLE:READ)
    // proves the fix is the page's fallback, not a widened grant.
    await expect(listRoles(recruiter)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listRoles(recruiter).catch(() => [])).resolves.toEqual([]);
  });

  it("sees the Approval Chains nav item via JOB:READ alone (the anyOf condition)", async () => {
    expect(await canAccessAdminNavItem(recruiter, "/admin/approval-chains")).toBe(true);
    await expect(listApprovalStepConfigs(recruiter, "JOB")).resolves.toBeDefined();
  });

  it("does not see admin nav items it has no grant for", async () => {
    for (const href of ["/admin/roles", "/admin/custom-fields", "/admin/communication-templates", "/admin/interview-reminders", "/admin/offer-settings", "/admin/data-retention", "/admin/audit-log"]) {
      expect(await canAccessAdminNavItem(recruiter, href)).toBe(false);
    }
  });
});
