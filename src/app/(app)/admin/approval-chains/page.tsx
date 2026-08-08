import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, getEffectiveScope } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { listApprovalStepConfigs } from "@/lib/services/approvals";
import { listRoles } from "@/lib/services/roles";
import { ApprovalChainsClient } from "@/components/admin/approval-chains-client";

export default async function ApprovalChainsPage() {
  const context = await getSessionContext();
  if (!context) return null;

  const [canViewJob, canViewOffer] = await Promise.all([
    can(context, ENTITY.JOB, "READ"),
    can(context, ENTITY.OFFER, "READ"),
  ]);
  if (!canViewJob && !canViewOffer) {
    redirect("/");
  }

  const [jobSteps, offerSteps, jobScope, offerScope, roles] = await Promise.all([
    canViewJob ? listApprovalStepConfigs(context, "JOB") : Promise.resolve([]),
    canViewOffer ? listApprovalStepConfigs(context, "OFFER") : Promise.resolve([]),
    getEffectiveScope(context, ENTITY.JOB, "UPDATE"),
    getEffectiveScope(context, ENTITY.OFFER, "UPDATE"),
    // ROLE:READ is in practice super-admin-only (same shape as
    // Organization settings) — degrade to an empty picker rather than
    // crashing the page for an edge-case admin who lacks it.
    listRoles(context).catch(() => []),
  ]);

  const roleOptions = roles.map((role) => ({ id: role.id, name: role.name }));

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approval Chains</h1>
        <p className="text-muted-foreground">
          §11.1/§11.6: configure an ordered sequence of approval steps for Job and Offer submissions, each requiring
          a specific role to decide it. An empty chain keeps today&apos;s single-step behavior — any approver with
          the entity&apos;s Approve permission decides it. Editing here only affects submissions made after the
          change; a job or offer already awaiting approval keeps the chain it was submitted under.
        </p>
      </div>
      <ApprovalChainsClient
        canViewJob={canViewJob}
        canViewOffer={canViewOffer}
        canEditJob={jobScope === "ALL"}
        canEditOffer={offerScope === "ALL"}
        initialJobSteps={JSON.parse(JSON.stringify(jobSteps))}
        initialOfferSteps={JSON.parse(JSON.stringify(offerSteps))}
        roles={roleOptions}
      />
    </div>
  );
}
