"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * Chip-style list-of-strings input — e.g. Job must-have/good-to-have
 * criteria (§11.1: "structured must-have / good-to-have criteria").
 * Generic: takes/returns a plain string[], no domain knowledge baked in.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const trimmed = draft.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setDraft("");
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs",
        className,
      )}
    >
      {value.map((item, index) => (
        <Badge key={`${item}-${index}`} variant="secondary" className="gap-1">
          {item}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={() => removeAt(index)}
              className="rounded-full hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      {!disabled ? (
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commitDraft();
            } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
              removeAt(value.length - 1);
            }
          }}
          onBlur={commitDraft}
          placeholder={value.length === 0 ? placeholder : undefined}
          className="min-w-24 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      ) : null}
    </div>
  );
}

