import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getOrganizationSettings } from "@/lib/services/organization";
import { OfferTatSettingsClient } from "@/components/admin/offer-tat-settings-client";

export default async function OfferSettingsPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.ORGANIZATION, "READ");

  const organization = await getOrganizationSettings(context);
  const canEdit = await can(context, ENTITY.ORGANIZATION, "UPDATE");

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Offer Settings</h1>
        <p className="text-muted-foreground">
          §11.6: the default turnaround-time (TAT) threshold, in business days, used by the Offer TAT Compliance
          report when a run doesn&apos;t supply its own threshold. Applies org-wide; a report can still override it
          per run without changing this setting.
        </p>
      </div>
      <OfferTatSettingsClient initialThresholdDays={organization.offerTatThresholdDays} canEdit={canEdit} />
    </div>
  );
}
