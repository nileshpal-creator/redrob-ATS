import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { can } from "@/lib/authz/authorize";
import { ENTITY } from "@/lib/entity-registry";
import { listCandidates } from "@/lib/services/candidates";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { candidateQuerySchema } from "@/lib/validations/candidate";
import { CandidatesClient } from "@/components/candidates/candidates-client";

export default async function CandidatesPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.CANDIDATE, "READ");

  const [result, sources, canCreate] = await Promise.all([
    listCandidates(context, candidateQuerySchema.parse({})),
    getControlledListValues("CANDIDATE_SOURCE"),
    can(context, ENTITY.CANDIDATE, "CREATE"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Candidates</h1>
        <p className="text-muted-foreground">The candidate database, based on your role&apos;s access.</p>
      </div>
      <CandidatesClient
        initialResult={JSON.parse(JSON.stringify(result))}
        sources={sources.values}
        canCreate={canCreate}
      />
    </div>
  );
}
