import type { VariantProps } from "class-variance-authority";

import type { badgeVariants } from "@/components/ui/badge";

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

/**
 * The canonical status-color legend for this app (see docs/design-system.md):
 *
 *   success (green)    — the desired/positive outcome, or "still open/active"
 *   warning (amber)     — pending an internal decision
 *   attention (orange)  — needs a nudge/follow-up, distinct from a hard failure
 *   destructive (red)   — terminal negative (rejected, cancelled, failed)
 *   info (blue)         — informational / waiting on someone outside the org
 *   secondary (gray)    — neutral, no positive/negative judgement
 *
 * Every module's own status enum (Job, Offer, Interview, Application,
 * WorkflowTask, Handoff, JobPosting, ...) still owns its own
 * `STATUS_BADGE_VARIANT` map next to where it's used — the enums and their
 * exact semantics differ per module, so a single shared lookup table isn't
 * the right shape. This type exists so every one of those maps is typed
 * against the same fixed vocabulary instead of each file inventing its own
 * subset of Badge variants.
 */
export const SEMANTIC_BADGE_VARIANTS = [
  "success",
  "warning",
  "attention",
  "destructive",
  "info",
  "secondary",
] as const satisfies readonly BadgeVariant[];

export type SemanticBadgeVariant = (typeof SEMANTIC_BADGE_VARIANTS)[number];
