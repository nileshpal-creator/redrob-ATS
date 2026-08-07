import { getSessionContext } from "@/lib/authz/session-context";
import { guardPage } from "@/lib/authz/guard";
import { ENTITY } from "@/lib/entity-registry";
import { getCandidateById } from "@/lib/services/candidates";
import { getJobById } from "@/lib/services/jobs";
import { ApplicationForm } from "@/components/applications/application-form";

export default async function NewApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ candidateId?: string; jobId?: string }>;
}) {
  const { candidateId, jobId } = await searchParams;
  const context = await getSessionContext();
  if (!context) return null;
  await guardPage(context, ENTITY.APPLICATION, "CREATE");

  // Deep-linked from a Candidate or Job detail page's "New application"
  // button — best-effort hydration only; an invalid/forbidden id just means
  // the form starts empty instead of pre-filled.
  const [initialCandidate, initialJob] = await Promise.all([
    candidateId
      ? getCandidateById(context, candidateId).catch(() => null)
      : Promise.resolve(null),
    jobId ? getJobById(context, jobId).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New application</h1>
        <p className="text-muted-foreground">Link a candidate to a job and drop them into its pipeline.</p>
      </div>
      <ApplicationForm
        initialCandidate={initialCandidate ? { id: initialCandidate.id, name: initialCandidate.name, phone: initialCandidate.phone, email: initialCandidate.email } : null}
        initialJob={initialJob ? { id: initialJob.id, title: initialJob.title } : null}
      />
    </div>
  );
}
