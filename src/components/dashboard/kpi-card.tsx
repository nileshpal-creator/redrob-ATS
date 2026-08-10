"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useCountUp } from "@/hooks/use-count-up";
import { cn } from "@/lib/utils";

/**
 * `icon` is a pre-rendered node (e.g. `<IconBadge module="jobs" icon={Briefcase} />`),
 * not a component reference — this is a Client Component (for the count-up
 * animation), and its caller is a Server Component. A bare component
 * reference (a function) can't cross that boundary as a prop; an
 * already-rendered element can.
 */
export function KpiCard({
  label,
  value,
  icon,
  href,
  hint,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  href?: string;
  hint?: string;
}) {
  const displayValue = useCountUp(value);

  const content = (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border bg-card p-4 transition-all motion-safe:duration-150",
        href && "hover:border-foreground/20 hover:shadow-sm motion-safe:hover:-translate-y-0.5",
      )}
    >
      {icon}
      <div className="min-w-0">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{displayValue}</p>
        <p className="truncate text-sm text-muted-foreground">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground/70">{hint}</p> : null}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
      {content}
    </Link>
  ) : (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">{content}</div>
  );
}
