import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EmptyStateAction = { label: string; href?: string; onClick?: () => void };

/**
 * The one shared empty state for the app — icon + short explanation +
 * optional primary/secondary action, replacing the bare "No X found" text
 * that used to be hand-rolled per page. Beginners land here often (an
 * empty Jobs/Candidates list on day one), so the copy should say what will
 * eventually appear and how to make that happen, not just that nothing's
 * there right now.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  size = "default",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  size?: "default" | "sm";
  className?: string;
}) {
  function renderAction(config: EmptyStateAction, variant: "default" | "outline") {
    if (config.href) {
      return (
        <Button asChild size="sm" variant={variant}>
          <Link href={config.href}>{config.label}</Link>
        </Button>
      );
    }
    return (
      <Button size="sm" variant={variant} onClick={config.onClick}>
        {config.label}
      </Button>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300",
        size === "sm" ? "px-4 py-8" : "px-6 py-14",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-muted",
          size === "sm" ? "size-9" : "size-12",
        )}
      >
        <Icon className={cn("text-muted-foreground", size === "sm" ? "size-4.5" : "size-6")} />
      </div>
      <div className="space-y-1">
        <p className={cn("font-medium", size === "sm" ? "text-sm" : "text-base")}>{title}</p>
        {description ? (
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action || secondaryAction ? (
        <div className="mt-1 flex items-center gap-2">
          {action ? renderAction(action, "default") : null}
          {secondaryAction ? renderAction(secondaryAction, "outline") : null}
        </div>
      ) : null}
    </div>
  );
}
