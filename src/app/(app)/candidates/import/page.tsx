import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { ENTITY } from "@/lib/entity-registry";
import { CandidateImportWizard } from "@/components/candidates/candidate-import-wizard";

export default async function ImportCandidatesPage() {
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.CANDIDATE, "CREATE");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import candidates</h1>
        <p className="text-muted-foreground">Upload a CSV or Excel file, review the preview, then confirm.</p>
      </div>
      <CandidateImportWizard />
    </div>
  );
}
