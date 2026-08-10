# Design system

A visual-design layer added on top of the existing shadcn-style primitives
(`src/components/ui/`) and Tailwind v4 CSS-variable theme
(`src/app/globals.css`). Nothing here touches business logic, RBAC, or the
database — it's colors, hierarchy, and small reusable components applied on
top of what already existed.

## Brand color

`--primary` (an indigo-blue, hue 264) is the Redrob brand accent, unchanged
from the earlier rebrand pass — this system builds on it rather than
replacing it. It's used for primary actions, the active-nav accent bar, and
the dashboard's hero gradient. It is deliberately **not** used to color
every module — see below.

## Status colors

A fixed, six-bucket vocabulary (`src/lib/status-colors.ts`), applied
consistently across every status badge in the app:

| Bucket        | Badge variant | Meaning                                             |
| ------------- | ------------- | ---------------------------------------------------- |
| Success       | `success`     | The desired/positive outcome, or "still open/active" |
| Pending       | `warning`     | Waiting on an internal decision (amber)              |
| Attention     | `attention`   | Needs a nudge — distinct from a hard failure (orange)|
| Error         | `destructive` | Terminal negative (rejected, cancelled, failed)      |
| Informational | `info`        | Waiting on someone outside the org, or upcoming      |
| Neutral       | `secondary`   | No positive/negative judgement                       |

`info` and `attention` are new `Badge` variants
(`src/components/ui/badge.tsx`); the other four already existed. Every
status enum in the app (Job, Offer, Interview, Application, WorkflowTask,
Handoff, JobPosting, ...) keeps its own `STATUS_BADGE_VARIANT` map next to
where it's used — the enums differ per module — but each map now draws from
this same six-color vocabulary instead of an ad-hoc subset.

## Module colors

Seven ATS modules get a distinct, low-saturation accent
(`src/lib/module-colors.ts`), used **only** for icons, small accent bars,
and tinted icon containers — never as a full-page or full-card background:

| Module      | Hue family     |
| ----------- | -------------- |
| Jobs        | Brand indigo   |
| Candidates  | Blue / cyan    |
| Interviews  | Violet         |
| Offers      | Green / emerald|
| Handoff     | Teal           |
| Reporting   | Amber / orange |
| Workflows   | Purple         |

Applied to: sidebar nav icons (`app-sidebar.tsx`), dashboard KPI cards and
module cards, the job detail "positions" stat, the candidate avatar
fallback, and pipeline board stage columns (cycled by column index, since
pipeline stages are user-defined per job — the cycle is purely for visual
distinction between columns, not a claim that "column 3 is the Interviews
module").

`IconBadge` (`src/components/ui/icon-badge.tsx`) is the one recurring
"colored icon in a tinted square" component — always the module's accent at
10% background opacity, never a solid fill, so several next to each other
still read as one calm surface.

## Gradients

Two CSS utility classes (`src/app/globals.css`, `@layer utilities`):
`bg-gradient-brand` (a very subtle brand tint, used once — the dashboard
hero) and `bg-gradient-brand-strong` (defined for future CTA/onboarding use,
not yet applied anywhere). Gradients are intentionally rare — this is not a
glassmorphism system.

## Motion

No new animation library. Hover/focus/active transitions use Tailwind's
`motion-safe:` variant (already established in the earlier rebrand pass);
enter/exit animations reuse `tw-animate-css` (already a dependency for
Dialog/Sheet). The only genuinely new pieces:

- `useCountUp` (`src/hooks/use-count-up.ts`) — a dependency-free
  requestAnimationFrame count-up for the dashboard KPI numbers, skipped
  entirely under `prefers-reduced-motion`.
- The pipeline board's stale-card indicator and column stale-count badge —
  a static visual cue (no animation), not a business rule.

`--motion-fast` / `--motion-base` / `--motion-slow` (`globals.css`) exist as
reference duration tokens for any future JS-driven transition that needs an
explicit number.

## Empty states

`EmptyState` (`src/components/ui/empty-state.tsx`) replaces the bare "No X
found" text that used to be hand-rolled per page: icon + short explanation +
optional primary/secondary action. Wired into `DataTable`'s default
`emptyMessage` and, with real copy and CTAs, into Jobs/Candidates/
Applications lists, My Tasks, and the Offers/Interviews sections of the
Application detail page.

## A note on RSC and icons

`KpiCard` is a Client Component (needed for the count-up hook), and its
caller (`src/app/(app)/page.tsx`) is a Server Component. A bare icon
component reference (a function) can't be passed as a prop across that
boundary — only an already-rendered element can. So `KpiCard` takes
`icon: ReactNode`, and the server page renders `<IconBadge icon={Briefcase} .../>`
itself before handing the result down. Keep this in mind before adding a
`LucideIcon`-typed prop to any other Client Component that a Server
Component might render.
