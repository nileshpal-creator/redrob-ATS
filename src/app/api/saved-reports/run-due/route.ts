import { withApiHandler } from "@/lib/api/handlers";
import { ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import { runDueScheduledReports } from "@/lib/services/scheduled-reports";

// A system-wide operation (it acts on every user's scheduled reports, not
// just the caller's own), gated the same way the rest of this codebase
// gates everything else — through the existing permission model rather
// than a bespoke isSuperAdmin check. No role is seeded with an ALL-scope
// SAVED_REPORT:UPDATE grant, so in practice only a super-admin role passes
// this today; an org can still widen it via the Roles screen.
export const POST = withApiHandler(async (context) => {
  await requirePermission(context, ENTITY.SAVED_REPORT, "UPDATE");
  return runDueScheduledReports();
});
