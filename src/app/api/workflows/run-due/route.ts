import { withApiHandler } from "@/lib/api/handlers";
import { ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import { runDueTimeInStageWorkflows } from "@/lib/services/workflows";

// A system-wide operation (it acts on every TIME_IN_STAGE workflow, not
// just the caller's own) — gated the same way Module 9's equivalent
// endpoint is, through the existing permission model rather than a bespoke
// isSuperAdmin check. No role is seeded with an ALL-scope
// WORKFLOW_DEFINITION:UPDATE grant, so in practice only a super-admin role
// passes this today.
export const POST = withApiHandler(async (context) => {
  await requirePermission(context, ENTITY.WORKFLOW_DEFINITION, "UPDATE");
  return runDueTimeInStageWorkflows();
});
