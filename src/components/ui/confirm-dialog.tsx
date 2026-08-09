"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

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

/**
 * Lightweight "are you sure?" confirmation for destructive actions that
 * already have a server-side guard against real damage (e.g. deleteRole
 * blocks while still assigned to users) — this is a misclick safety net,
 * not the enforcement boundary, so it doesn't need the heavier
 * type-the-name-to-confirm pattern users-client.tsx's DeleteUserDialog uses
 * for irreversible account deletion. No AlertDialog primitive exists in
 * this codebase, so this is built on the same Dialog primitive every other
 * modal here uses.
 *
 * `onConfirm` should toast its own specific error message and rethrow on
 * failure — that's what keeps the dialog open instead of closing on a
 * failed delete; it resolving is what closes it.
 */
export function ConfirmDeleteDialog({
  trigger,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setDeleting(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // onConfirm already reported the specific failure via toast.error.
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={deleting}>
            {deleting ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
