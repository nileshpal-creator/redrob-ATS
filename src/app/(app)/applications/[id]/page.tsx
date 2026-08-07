import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getApplication } from "@/lib/services/applications";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { NotFoundError } from "@/lib/errors";
import { ApplicationDetailClient } from "@/components/applications/application-detail-client";

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!context) return null;

  const application = await getApplication(context, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) redirect("/applications");
    throw error;
  });

  const [canEdit, rejectionReasons] = await Promise.all([
    can(context, ENTITY.APPLICATION, "UPDATE", { ownerId: application.ownerId }),
    getControlledListValues("REJECTION_REASON"),
  ]);

  return (
    <ApplicationDetailClient
      application={JSON.parse(JSON.stringify(application))}
      canEdit={canEdit}
      rejectionReasons={rejectionReasons.values}
    />
  );
}
