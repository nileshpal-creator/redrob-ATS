"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

export type RecruiterAssignment = { userId: string; isPrimary: boolean };

type DirectoryUser = { id: string; name: string; email: string; isActive: boolean };

/**
 * Assign one or more recruiters with exactly one primary (§11.1). Shared by
 * the Job create form and the recruiters-management dialog on the detail
 * page — both operate on the same `RecruiterAssignment[]` shape the API
 * expects.
 */
export function RecruiterPicker({
  value,
  onChange,
  disabled,
}: {
  value: RecruiterAssignment[];
  onChange: (next: RecruiterAssignment[]) => void;
  disabled?: boolean;
}) {
  const [users, setUsers] = useState<DirectoryUser[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/users")
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load users");
        return response.json();
      })
      .then((data: DirectoryUser[]) => {
        if (!cancelled) setUsers(data.filter((user) => user.isActive));
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        toast.error("Failed to load users. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return <p className="text-sm text-destructive">Failed to load users.</p>;
  }

  if (users === null) {
    return <Skeleton className="h-32 w-full" />;
  }

  function toggle(userId: string, checked: boolean) {
    if (checked) {
      const makesPrimary = value.length === 0;
      onChange([...value, { userId, isPrimary: makesPrimary }]);
    } else {
      const remaining = value.filter((assignment) => assignment.userId !== userId);
      // If the removed recruiter was primary, promote the first remaining one.
      if (remaining.length > 0 && !remaining.some((assignment) => assignment.isPrimary)) {
        remaining[0] = { ...remaining[0], isPrimary: true };
      }
      onChange(remaining);
    }
  }

  function makePrimary(userId: string) {
    onChange(value.map((assignment) => ({ ...assignment, isPrimary: assignment.userId === userId })));
  }

  return (
    <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
      {users.map((user) => {
        const assignment = value.find((a) => a.userId === user.id);
        const isSelected = Boolean(assignment);

        return (
          <div key={user.id} className="flex items-center justify-between gap-2 rounded px-1 py-1.5 text-sm">
            <label className="flex flex-1 items-center gap-2">
              <Checkbox
                disabled={disabled}
                checked={isSelected}
                onCheckedChange={(checked) => toggle(user.id, checked === true)}
              />
              <span className="truncate">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            </label>
            {isSelected ? (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="radio"
                  name="primary-recruiter"
                  disabled={disabled}
                  checked={assignment?.isPrimary ?? false}
                  onChange={() => makePrimary(user.id)}
                />
                Primary
              </label>
            ) : null}
          </div>
        );
      })}
      {users.length === 0 ? (
        <p className="p-2 text-sm text-muted-foreground">No active users found.</p>
      ) : null}
    </div>
  );
}
