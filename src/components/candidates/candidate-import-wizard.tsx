"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PreviewRow = {
  row: number;
  data: Record<string, unknown>;
  status: "valid" | "duplicate" | "invalid";
  errors?: string[];
  existingCandidateId?: string;
};

const STATUS_BADGE: Record<PreviewRow["status"], "success" | "warning" | "destructive"> = {
  valid: "success",
  duplicate: "warning",
  invalid: "destructive",
};

/**
 * Bulk import (§11.2 FR1/FR3), sequenced after core CRUD per the Phase 1
 * decision: upload → preview (server validates + duplicate-checks every
 * row, writes nothing) → commit (creates only the rows the user confirms).
 */
export function CandidateImportWizard() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  async function handlePreview() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a CSV or Excel file first.");
      return;
    }
    setPreviewing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/candidates/import/preview", { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to parse the file");
      }
      setRows(body.rows);
      setExcluded(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to parse the file");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCommit() {
    if (!rows) return;
    const rowsToImport = rows.filter((row) => row.status === "valid" && !excluded.has(row.row));
    if (rowsToImport.length === 0) {
      toast.error("No valid rows selected to import.");
      return;
    }

    setCommitting(true);
    try {
      const response = await fetch("/api/candidates/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsToImport.map((row) => row.data) }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Import failed");
      }
      setResult({ created: body.created.length, skipped: body.skipped.length });
      toast.success(`Imported ${body.created.length} candidate(s).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  }

  if (result) {
    return (
      <Card className="max-w-xl">
        <CardContent className="space-y-4 pt-6">
          <p>
            Created <span className="font-medium">{result.created}</span> candidate
            {result.created === 1 ? "" : "s"}.
            {result.skipped > 0 ? ` ${result.skipped} row(s) were skipped as duplicates.` : ""}
          </p>
          <Button onClick={() => router.push("/candidates")}>Go to candidates</Button>
        </CardContent>
      </Card>
    );
  }

  const validCount = rows?.filter((row) => row.status === "valid" && !excluded.has(row.row)).length ?? 0;

  return (
    <div className="space-y-4">
      <Card className="max-w-xl">
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm text-muted-foreground">
            Expected columns: name, phone, email, location, currentCompensation, expectedCompensation,
            noticePeriodDays, earliestAvailability, totalExperienceYears, skills, tags, sourceId, consentGivenAt.
            Rows without a real consent value are rejected — consent is never assumed.
          </p>
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="text-sm" />
            <Button variant="outline" onClick={handlePreview} disabled={previewing}>
              {previewing ? <Loader2 className="animate-spin" /> : <Upload />}
              Preview
            </Button>
          </div>
        </CardContent>
      </Card>

      {rows ? (
        <div className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Row</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.row}>
                  <TableCell>
                    {row.status === "valid" ? (
                      <Checkbox
                        checked={!excluded.has(row.row)}
                        onCheckedChange={(checked) =>
                          setExcluded((prev) => {
                            const next = new Set(prev);
                            if (checked) next.delete(row.row);
                            else next.add(row.row);
                            return next;
                          })
                        }
                      />
                    ) : null}
                  </TableCell>
                  <TableCell>{row.row}</TableCell>
                  <TableCell>{String(row.data.name ?? "—")}</TableCell>
                  <TableCell>{String(row.data.phone ?? "—")}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[row.status]}>{row.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.status === "invalid" ? row.errors?.join("; ") : null}
                    {row.status === "duplicate" ? "Matches an existing candidate — will not be created." : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Button onClick={handleCommit} disabled={committing || validCount === 0}>
            {committing ? <Loader2 className="animate-spin" /> : null}
            Import {validCount} candidate{validCount === 1 ? "" : "s"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
