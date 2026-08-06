import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { ENTITY } from "@/lib/entity-registry";
import { getControlledListValues } from "@/lib/services/controlled-lists";
import { CandidateForm } from "@/components/candidates/candidate-form";

export default async function NewCandidatePage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.CANDIDATE, "CREATE");

  const [sources, documentTypes] = await Promise.all([
    getControlledListValues("CANDIDATE_SOURCE"),
    getControlledListValues("DOCUMENT_TYPE"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New candidate</h1>
        <p className="text-muted-foreground">Phone is checked for duplicates as you type.</p>
      </div>
      <CandidateForm mode="create" sources={sources.values} documentTypes={documentTypes.values} />
    </div>
  );
}
