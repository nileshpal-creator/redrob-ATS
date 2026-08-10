"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export type PriorApplication = { id: string; outcome: "ACTIVE" | "REJECTED" | "WITHDRAWN"; createdAt: string };

// Status-color legend (docs/design-system.md) — kept in sync with the same
// map in applications-client.tsx by hand (client components, no shared import).
const OUTCOME_BADGE_VARIANT: Record<string, "success" | "secondary" | "destructive"> = {
  ACTIVE: "success",
  REJECTED: "destructive",
  WITHDRAWN: "secondary",
};

/**
 * Non-blocking re-add warning (§11.4: "warn when re-adding a candidate
 * previously in the pipeline for the same job") — mirrors
 * CandidateDuplicateCheck's shape, but nothing here ever blocks submission;
 * the server has no hard-uniqueness constraint on (candidateId, jobId)
 * either, by design.
 */
export function ApplicationDuplicateCheck({ priorApplications }: { priorApplications: PriorApplication[] }) {
  if (priorApplications.length === 0) {
    return null;
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1.5">
        <p>
          This candidate already has {priorApplications.length} application
          {priorApplications.length === 1 ? "" : "s"} for this job. You can still create a new one.
        </p>
        <ul className="space-y-1">
          {priorApplications.map((application) => (
            <li key={application.id}>
              <Link href={`/applications/${application.id}`} className="font-medium underline">
                View application
              </Link>{" "}
              <Badge variant={OUTCOME_BADGE_VARIANT[application.outcome]}>{application.outcome}</Badge>{" "}
              <span className="text-muted-foreground">
                &middot; {new Date(application.createdAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
