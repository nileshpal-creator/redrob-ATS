"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export type DuplicateMatch = { id: string; name: string; phone: string; email: string | null };

/**
 * Pre-flight duplicate warning (§11.2 FR5) — a courtesy check the create
 * form runs as the user types; the server re-checks and is the real
 * enforcement (a hard phone match still blocks POST /api/candidates with a
 * 409 regardless of what this component shows).
 */
export function CandidateDuplicateCheck({
  hardMatch,
  softMatch,
}: {
  hardMatch: DuplicateMatch | null;
  softMatch: DuplicateMatch | null;
}) {
  if (!hardMatch && !softMatch) {
    return null;
  }

  if (hardMatch) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>
          A candidate with this phone number already exists:{" "}
          <Link href={`/candidates/${hardMatch.id}`} className="font-medium underline">
            {hardMatch.name}
          </Link>
          . Change the phone number, or view the existing candidate to merge/link instead.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p>
        A candidate with this email may already exist:{" "}
        <Link href={`/candidates/${softMatch!.id}`} className="font-medium underline">
          {softMatch!.name}
        </Link>
        . You can still create a new record — merge them afterward if they&apos;re the same person.
      </p>
    </div>
  );
}
