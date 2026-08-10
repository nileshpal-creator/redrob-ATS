import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MODULE_BG_SOFT_CLASS, MODULE_TEXT_CLASS, type ModuleKey } from "@/lib/module-colors";

const SIZE_CLASS = {
  sm: { box: "size-7 rounded-md", icon: "size-3.5" },
  md: { box: "size-9 rounded-lg", icon: "size-4.5" },
  lg: { box: "size-11 rounded-lg", icon: "size-5" },
} as const;

/**
 * A module-colored icon container — the one recurring "colored icon in a
 * tinted square" element used for KPI cards, section headings, and empty
 * states. Always the module's accent at low opacity for the background
 * (never a solid fill), so a page with several of these next to each other
 * still reads as one calm surface, not a rainbow of solid chips.
 */
export function IconBadge({
  module,
  icon: Icon,
  size = "md",
  className,
}: {
  module: ModuleKey;
  icon: LucideIcon;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { box, icon } = SIZE_CLASS[size];
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center",
        box,
        MODULE_BG_SOFT_CLASS[module],
        className,
      )}
    >
      <Icon className={cn(icon, MODULE_TEXT_CLASS[module])} />
    </div>
  );
}
