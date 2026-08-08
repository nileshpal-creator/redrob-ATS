import { prisma } from "@/lib/prisma";
import { DuplicateCandidateError, NotFoundError, ValidationError } from "@/lib/errors";
import { ENTITY } from "@/lib/entity-registry";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import type { SessionContext } from "@/lib/authz/session-context";
import { addCandidateNote, createCandidate } from "@/lib/services/candidates";
import { createApplication } from "@/lib/services/applications";
import type { ReferralCreateInput } from "@/lib/validations/job-posting";

/**
 * "Refer a candidate" (§11.3: "Referral capture as a distinct source
 * type") — one combined step for a person not yet in the system: create
 * the Candidate (source = the "Referral" CANDIDATE_SOURCE value) and an
 * Application for the named job together, rather than the two separate
 * multi-field forms (/candidates/new then /applications/new) a recruiter
 * would otherwise need. No new permission resource — createCandidate/
 * createApplication each enforce their own existing grant
 * (CANDIDATE:CREATE / APPLICATION:CREATE), which is all this needs.
 *
 * Best-effort, not atomic across the two creates (same documented
 * precedent as bulkTransitionApplications) — refactoring createCandidate/
 * createApplication to share a transaction client is a larger, riskier
 * change than this module needs; if the application create fails after the
 * candidate was created, the candidate record still exists and the
 * application can be created separately via the normal /applications/new
 * flow.
 */
export async function createReferral(context: SessionContext, input: ReferralCreateInput) {
  const job = await prisma.job.findUnique({ where: { id: input.jobId }, select: { id: true } });
  if (!job) {
    throw new NotFoundError("Job not found.");
  }

  const referralSource = await prisma.controlledListValue.findFirst({
    where: { list: { key: "CANDIDATE_SOURCE" }, label: "Referral", isActive: true },
  });
  if (!referralSource) {
    throw new ValidationError('No active "Referral" value configured under the Candidate Sources list.');
  }

  let candidate;
  try {
    candidate = await createCandidate(context, {
      name: input.name,
      phone: input.phone,
      email: input.email,
      sourceId: referralSource.id,
      consentGivenAt: new Date(),
      skills: [],
      tags: [],
    });
  } catch (error) {
    if (error instanceof DuplicateCandidateError) {
      candidate = await prisma.candidate.findUniqueOrThrow({ where: { id: error.existingCandidateId } });
    } else {
      throw error;
    }
  }

  const application = await createApplication(context, { candidateId: candidate.id, jobId: input.jobId });

  if (input.note) {
    await addCandidateNote(context, candidate.id, { body: `Referral note: ${input.note}` });
  }

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CANDIDATE_REFERRED,
    entityType: ENTITY.APPLICATION,
    entityId: application.id,
    changes: { after: { jobId: input.jobId, candidateId: candidate.id } },
  });

  return application;
}
