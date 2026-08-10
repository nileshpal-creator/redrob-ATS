import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type AttentionRow = {
  icon: LucideIcon;
  label: string;
  href: string;
  tone: "attention" | "warning" | "info";
};

const TONE_CLASS: Record<AttentionRow["tone"], string> = {
  attention: "bg-attention/10 text-attention",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
};

/** The dashboard's "what needs attention" panel — every row is something with a nonzero count right now. */
export function AttentionPanel({ items }: { items: AttentionRow[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Nothing needs your attention right now.
      </div>
    );
  }

  return (
    <div className="divide-y rounded-xl border bg-card">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="flex items-center gap-3 p-3 text-sm transition-colors hover:bg-accent/50"
        >
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", TONE_CLASS[item.tone])}>
            <item.icon className="size-4" />
          </span>
          <span className="flex-1">{item.label}</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      ))}
    </div>
  );
}
