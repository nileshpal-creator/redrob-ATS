"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Loader2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const NONE = "__none__";

// Mirrors CANDIDATE_IMPORT_FIELDS in src/lib/services/candidate-import.ts —
// duplicated here (label text only) so this client component doesn't need
// to import that server-only module (it pulls in ExcelJS/prisma).
const IMPORT_FIELDS = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "location", label: "Location" },
  { key: "currentCompensation", label: "Current compensation" },
  { key: "expectedCompensation", label: "Expected compensation" },
  { key: "noticePeriodDays", label: "Notice period (days)" },
  { key: "earliestAvailability", label: "Earliest availability" },
  { key: "totalExperienceYears", label: "Total experience (years)" },
  { key: "skills", label: "Skills" },
  { key: "tags", label: "Tags" },
  { key: "sourceId", label: "Source" },
  { key: "consentGivenAt", label: "Consent given at" },
] as const;

type Step = "upload" | "mapping" | "preview" | "done";

/**
 * Bulk import (§11.2 FR1/FR3), sequenced after core CRUD per the Phase 1
 * decision: upload → map columns (this file's own headers might not match
 * the expected field names) → preview (server validates + duplicate-checks
 * every row, writes nothing) → commit (creates only the rows the user
 * confirms).
 */
export function CandidateImportWizard() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [loadingHeaders, setLoadingHeaders] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  async function handleChooseFile() {
    const chosen = fileInputRef.current?.files?.[0];
    if (!chosen) {
      toast.error("Choose a CSV or Excel file first.");
      return;
    }
    setFile(chosen);
    setLoadingHeaders(true);
    try {
      const formData = new FormData();
      formData.append("file", chosen);
      const response = await fetch("/api/candidates/import/headers", { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to read the file's columns");
      }
      setHeaders(body.headers);
      setMapping(body.suggestedMapping);
      setStep("mapping");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to read the file's columns");
    } finally {
      setLoadingHeaders(false);
    }
  }

  async function handlePreview() {
    if (!file) return;
    setPreviewing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));
      const response = await fetch("/api/candidates/import/preview", { method: "POST", body: formData });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to parse the file");
      }
      setRows(body.rows);
      setExcluded(new Set());
      setStep("preview");
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
      setStep("done");
      toast.success(`Imported ${body.created.length} candidate(s).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  }

  if (step === "done" && result) {
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
      {step === "upload" ? (
        <Card className="max-w-xl">
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-muted-foreground">
              Upload a CSV or Excel file — you&apos;ll map its columns to the expected candidate fields next, so it
              doesn&apos;t need to use these exact header names.
            </p>
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="text-sm" />
              <Button variant="outline" onClick={handleChooseFile} disabled={loadingHeaders}>
                {loadingHeaders ? <Loader2 className="animate-spin" /> : <Upload />}
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "mapping" ? (
        <Card className="max-w-xl">
          <CardContent className="space-y-4 pt-6">
            <div>
              <p className="font-medium">Map your columns</p>
              <p className="text-sm text-muted-foreground">
                {file?.name} — {headers.length} column{headers.length === 1 ? "" : "s"} detected. Fields left as
                &quot;Don&apos;t import&quot; are skipped; a required field left unmapped will show as invalid in the
                preview. Consent must come from a real column — it&apos;s never assumed.
              </p>
            </div>
            <div className="space-y-2">
              {IMPORT_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{field.label}</span>
                  <Select
                    value={mapping[field.key] ?? NONE}
                    onValueChange={(value) =>
                      setMapping((prev) => ({ ...prev, [field.key]: value === NONE ? null : value }))
                    }
                  >
                    <SelectTrigger size="sm" className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Don&apos;t import</SelectItem>
                      {headers.map((header) => (
                        <SelectItem key={header} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button onClick={handlePreview} disabled={previewing}>
                {previewing ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                Preview import
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "preview" && rows ? (
        <div className="space-y-3">
          <Button variant="ghost" size="sm" onClick={() => setStep("mapping")}>
            Back to column mapping
          </Button>
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
