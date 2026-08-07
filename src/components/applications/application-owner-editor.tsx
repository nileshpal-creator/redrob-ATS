"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type DirectoryUser = { id: string; name: string; email: string; isActive: boolean };

/** Reassign Application.ownerId — remains reassignable after the Phase 2 default-from-primary-recruiter rule applies only at creation. */
export function ApplicationOwnerEditor({
  applicationId,
  version,
  currentOwnerId,
}: {
  applicationId: string;
  version: number;
  currentOwnerId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<DirectoryUser[] | null>(null);
  const [ownerId, setOwnerId] = useState(currentOwnerId);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/users")
      .then((response) => response.json())
      .then((data: DirectoryUser[]) => {
        if (!cancelled) setUsers(data.filter((user) => user.isActive));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleSave() {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, ownerId }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to reassign owner");
      }
      toast.success("Owner updated.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reassign owner");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserCog /> Reassign owner
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign owner</DialogTitle>
          <DialogDescription>Choose who owns this application going forward.</DialogDescription>
        </DialogHeader>
        {users === null ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select an owner" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button onClick={handleSave} disabled={submitting || ownerId === currentOwnerId}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
