import { notFound, redirect } from "next/navigation";

import { getSessionContext } from "@/lib/authz/session-context";
import { can, ForbiddenError } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { getCandidateById, getCandidateTimeline } from "@/lib/services/candidates";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { NotFoundError } from "@/lib/errors";
import { CandidateDetailClient } from "@/components/candidates/candidate-detail-client";

export default async function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!context) return null;

  const candidate = await getCandidateById(context, id).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) redirect("/candidates");
    throw error;
  });

  const [timeline, documentTypes, canEdit, canDelete] = await Promise.all([
    getCandidateTimeline(context, id),
    getControlledListValues("DOCUMENT_TYPE"),
    can(context, ENTITY.CANDIDATE, "UPDATE", { ownerId: candidate.createdById }),
    can(context, ENTITY.CANDIDATE, "DELETE", { ownerId: candidate.createdById }),
  ]);

  return (
    <CandidateDetailClient
      candidate={JSON.parse(JSON.stringify(candidate))}
      documentTypes={documentTypes.values}
      timelineItems={JSON.parse(JSON.stringify(timeline.items))}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  );
}
