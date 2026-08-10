/**
 * One accent color per recognizable ATS module (docs/design-system.md).
 * Deliberately a SMALL, fixed set of modules — not every route gets a
 * color, only the ones a user should learn to recognize at a glance
 * (sidebar icons, section headings, empty-state icons, small tags). Class
 * strings are written out in full and never constructed dynamically:
 * Tailwind's build-time content scanner needs a literal class name
 * somewhere in the source to generate the corresponding utility.
 */
export type ModuleKey =
  | "jobs"
  | "candidates"
  | "interviews"
  | "offers"
  | "handoff"
  | "reporting"
  | "workflows";

export const MODULE_LABELS: Record<ModuleKey, string> = {
  jobs: "Jobs",
  candidates: "Candidates",
  interviews: "Interviews",
  offers: "Offers",
  handoff: "Handoff",
  reporting: "Reporting",
  workflows: "Workflows",
};

/** Icon glyph / text color. */
export const MODULE_TEXT_CLASS: Record<ModuleKey, string> = {
  jobs: "text-module-jobs",
  candidates: "text-module-candidates",
  interviews: "text-module-interviews",
  offers: "text-module-offers",
  handoff: "text-module-handoff",
  reporting: "text-module-reporting",
  workflows: "text-module-workflows",
};

/** Tinted background for icon containers / soft chips (pair with the text class above). */
export const MODULE_BG_SOFT_CLASS: Record<ModuleKey, string> = {
  jobs: "bg-module-jobs/10",
  candidates: "bg-module-candidates/10",
  interviews: "bg-module-interviews/10",
  offers: "bg-module-offers/10",
  handoff: "bg-module-handoff/10",
  reporting: "bg-module-reporting/10",
  workflows: "bg-module-workflows/10",
};

/** Solid accent bars / borders (job pipeline stage headers, selected-card left edge). */
export const MODULE_BORDER_CLASS: Record<ModuleKey, string> = {
  jobs: "border-module-jobs",
  candidates: "border-module-candidates",
  interviews: "border-module-interviews",
  offers: "border-module-offers",
  handoff: "border-module-handoff",
  reporting: "border-module-reporting",
  workflows: "border-module-workflows",
};

/** Which sidebar nav item (by href) gets which module's color — icons for
 * routes outside this map (Dashboard, My Tasks, Applications, Admin's own
 * pages) stay neutral, since they aren't one of the seven recognizable
 * modules. */
export const NAV_HREF_MODULE: Record<string, ModuleKey> = {
  "/jobs": "jobs",
  "/candidates": "candidates",
  "/interviews": "interviews",
  "/reports": "reporting",
  "/admin/workflows": "workflows",
};
