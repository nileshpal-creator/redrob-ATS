"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";

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
import { RecruiterPicker, type RecruiterAssignment } from "@/components/jobs/recruiter-picker";

export function JobRecruitersEditor({
  jobId,
  version,
  currentAssignments,
}: {
  jobId: string;
  version: number;
  currentAssignments: RecruiterAssignment[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [assignments, setAssignments] = useState<RecruiterAssignment[]>(currentAssignments);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    if (assignments.length === 0) {
      toast.error("Assign at least one recruiter.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/jobs/${jobId}/recruiters`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, assignments }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to update recruiters");
      }
      toast.success("Recruiters updated.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update recruiters");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users /> Manage recruiters
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage recruiters</DialogTitle>
          <DialogDescription>Choose exactly one primary recruiter.</DialogDescription>
        </DialogHeader>
        <RecruiterPicker value={assignments} onChange={setAssignments} />
        <DialogFooter>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
