"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { type ColumnDef } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Mirrors organizationSettingsUpdateSchema's own cap (src/lib/validations/organization.ts). */
const MAX_RETENTION_DAYS = 3650;

type ErasureRequestRow = {
  id: string;
  method: "ANONYMIZE" | "HARD_DELETE";
  status: "PENDING" | "COMPLETED" | "REJECTED";
  reason: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decisionNotes: string | null;
  // null once a HARD_DELETE decision removes the candidate row (onDelete:
  // SetNull) — this request's own history still stands as the audit record.
  candidate: { id: string; name: string; phone: string; anonymizedAt: string | null } | null;
  requestedBy: { id: string; name: string } | null;
  decidedBy: { id: string; name: string } | null;
};

async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed");
  }
  return body;
}

function RetentionSettingsCard({
  initialRetentionDays,
  canEdit,
}: {
  initialRetentionDays: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialRetentionDays !== null);
  const [value, setValue] = useState(String(initialRetentionDays ?? 730));
  const [saving, setSaving] = useState(false);

  const parsed = Number(value);
  const isValid = !enabled || (Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_RETENTION_DAYS);

  async function handleSave() {
    if (!isValid) {
      toast.error(`Enter a whole number of days between 1 and ${MAX_RETENTION_DAYS}.`);
      return;
    }
    setSaving(true);
    try {
      await requestJson("/api/organization", {
        method: "PATCH",
        body: JSON.stringify({ candidateRetentionDays: enabled ? parsed : null }),
      });
      toast.success("Retention setting saved.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={enabled} disabled={!canEdit} onCheckedChange={(checked) => setEnabled(checked === true)} />
          Automatically anonymize candidates past a retention window
        </label>
        <div className="space-y-2">
          <Label>Retention window (days from creation)</Label>
          <Input
            type="number"
            min={1}
            max={MAX_RETENTION_DAYS}
            value={value}
            disabled={!canEdit || !enabled}
            onChange={(event) => setValue(event.target.value)}
            className="w-32"
          />
          <p className="text-sm text-muted-foreground">
            A candidate with any active (non-terminal) application is never swept, regardless of age.
          </p>
        </div>
        {canEdit ? (
          <Button onClick={handleSave} disabled={saving || !isValid}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DecideDialog({
  request,
  onDecided,
}: {
  request: ErasureRequestRow;
  onDecided: (updated: ErasureRequestRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState<"APPROVE" | "REJECT" | null>(null);

  async function decide(decision: "APPROVE" | "REJECT") {
    setSubmitting(decision);
    try {
      const updated = await requestJson(`/api/erasure-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({ decision, decisionNotes: notes || undefined }),
      });
      onDecided({ ...request, status: updated.status, decisionNotes: updated.decisionNotes, decidedAt: updated.decidedAt });
      toast.success(decision === "APPROVE" ? "Erasure request approved and executed." : "Erasure request rejected.");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to decide request");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        Review
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Decide erasure request</DialogTitle>
          <DialogDescription>
            {request.method === "ANONYMIZE"
              ? `Approving overwrites ${request.candidate?.name ?? "this candidate"}'s personal fields immediately; pipeline history is kept.`
              : `Approving permanently deletes ${request.candidate?.name ?? "this candidate"}'s record (blocked if they have applications).`}
          </DialogDescription>
        </DialogHeader>
        {request.reason ? (
          <p className="rounded-md border bg-muted/50 p-2 text-sm">
            <span className="font-medium">Requester&apos;s reason: </span>
            {request.reason}
          </p>
        ) : null}
        <div className="space-y-2">
          <Label>Decision notes (optional)</Label>
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => decide("REJECT")} disabled={submitting !== null}>
            {submitting === "REJECT" ? <Loader2 className="animate-spin" /> : null}
            Reject
          </Button>
          <Button onClick={() => decide("APPROVE")} disabled={submitting !== null}>
            {submitting === "APPROVE" ? <Loader2 className="animate-spin" /> : null}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DataRetentionClient({
  initialRetentionDays,
  canEditSettings,
  canDecide,
}: {
  initialRetentionDays: number | null;
  canEditSettings: boolean;
  canDecide: boolean;
}) {
  const [requests, setRequests] = useState<ErasureRequestRow[] | null>(null);

  useEffect(() => {
    if (!canDecide) {
      setRequests([]);
      return;
    }
    let cancelled = false;
    requestJson("/api/erasure-requests?pageSize=100")
      .then((result) => {
        if (!cancelled) setRequests(result.requests);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load requests"));
    return () => {
      cancelled = true;
    };
  }, [canDecide]);

  function handleDecided(updated: ErasureRequestRow) {
    setRequests((prev) => prev?.map((row) => (row.id === updated.id ? updated : row)) ?? null);
  }

  const columns: ColumnDef<ErasureRequestRow, unknown>[] = [
    {
      header: "Candidate",
      cell: ({ row }) => (
        <span>
          {!row.original.candidate
            ? "Deleted candidate"
            : row.original.candidate.anonymizedAt
              ? "Anonymized candidate"
              : row.original.candidate.name}
        </span>
      ),
    },
    { header: "Method", cell: ({ row }) => <Badge variant="secondary">{row.original.method}</Badge> },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.status === "COMPLETED"
              ? "default"
              : row.original.status === "REJECTED"
                ? "destructive"
                : "outline"
          }
        >
          {row.original.status}
        </Badge>
      ),
    },
    { header: "Requested by", cell: ({ row }) => row.original.requestedBy?.name ?? "System (retention sweep)" },
    { header: "Requested", cell: ({ row }) => new Date(row.original.requestedAt).toLocaleString() },
    {
      header: "",
      id: "actions",
      cell: ({ row }) =>
        row.original.status === "PENDING" && canDecide ? (
          <div className="flex justify-end">
            <DecideDialog request={row.original} onDecided={handleDecided} />
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <RetentionSettingsCard initialRetentionDays={initialRetentionDays} canEdit={canEditSettings} />
      {canDecide ? (
        requests === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <DataTable columns={columns} data={requests} emptyMessage="No erasure requests yet." />
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to review erasure requests.
        </p>
      )}
    </div>
  );
}
