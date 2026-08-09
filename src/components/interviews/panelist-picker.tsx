"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

type DirectoryUser = { id: string; name: string; email: string; isActive: boolean };

/**
 * Assign one or more interviewers to a panel (§11.5). Simpler than
 * RecruiterPicker — panelists have no "primary" concept — but shares its
 * checkbox-list-over-/api/users shape.
 */
export function PanelistPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
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
    onChange(checked ? [...value, userId] : value.filter((id) => id !== userId));
  }

  return (
    <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
      {users.map((user) => (
        <label key={user.id} className="flex items-center gap-2 rounded px-1 py-1.5 text-sm">
          <Checkbox
            disabled={disabled}
            checked={value.includes(user.id)}
            onCheckedChange={(checked) => toggle(user.id, checked === true)}
          />
          <span className="truncate">{user.name}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </label>
      ))}
      {users.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No active users found.</p> : null}
    </div>
  );
}
