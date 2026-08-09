"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Wraps a row of filter controls so it collapses behind a toggle below the
 * `lg` breakpoint instead of wrapping into a tall stack of narrow inputs.
 */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="lg:hidden"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <SlidersHorizontal className="size-4" />
        Filters
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </Button>
      <div className={cn("flex-wrap items-end gap-2 lg:flex", open ? "flex" : "hidden", className)}>
        {children}
      </div>
    </div>
  );
}
