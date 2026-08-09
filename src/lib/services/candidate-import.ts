import ExcelJS from "exceljs";

import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { DuplicateCandidateError } from "@/lib/errors";
import {
  candidateCreateSchema,
  type CandidateImportCommitInput,
  type CandidateImportColumnMapping,
} from "@/lib/validations/candidate";
import { createCandidate } from "./candidates";

/** Bulk import (§11.2, sequenced after core CRUD per the Phase 1 decision). */

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });
}

function getCsvHeaders(text: string): string[] {
  const firstLine = text.split(/\r\n|\n/).find((line) => line.length > 0);
  return firstLine ? parseCsvLine(firstLine).map((header) => header.trim()).filter(Boolean) : [];
}

async function loadXlsxWorksheet(buffer: Buffer): Promise<ExcelJS.Worksheet | undefined> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook.worksheets[0];
}

function readXlsxHeaders(worksheet: ExcelJS.Worksheet): string[] {
  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });
  return headers;
}

async function parseXlsx(buffer: Buffer): Promise<Record<string, string>[]> {
  const worksheet = await loadXlsxWorksheet(buffer);
  if (!worksheet) return [];

  const headers = readXlsxHeaders(worksheet);
  const rows: Record<string, string>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) {
        record[header] = cell.text ?? String(cell.value ?? "");
      }
    });
    rows.push(record);
  });
  return rows;
}

/** Header row only — powers the column-mapping step before a full parse+validate preview. */
export async function getCandidateImportFileHeaders(
  context: SessionContext,
  buffer: Buffer,
  fileName: string,
): Promise<{ headers: string[]; suggestedMapping: CandidateImportColumnMapping }> {
  await requirePermission(context, ENTITY.CANDIDATE, "CREATE");

  let headers: string[];
  if (fileName.toLowerCase().endsWith(".csv")) {
    headers = getCsvHeaders(buffer.toString("utf-8"));
  } else {
    const worksheet = await loadXlsxWorksheet(buffer);
    headers = worksheet ? readXlsxHeaders(worksheet).filter(Boolean) : [];
  }

  const suggestedMapping: CandidateImportColumnMapping = {};
  for (const field of CANDIDATE_IMPORT_FIELDS) {
    const match = headers.find((header) => header.toLowerCase() === field.key.toLowerCase());
    suggestedMapping[field.key] = match ?? null;
  }

  return { headers, suggestedMapping };
}

/** Every field the importer can populate — drives the column-mapping UI and its suggested defaults. */
export const CANDIDATE_IMPORT_FIELDS = [
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

/**
 * `mapping` is the user-confirmed field -> file-column assignment from the
 * column-mapping step. When omitted entirely (no mapping step was run —
 * e.g. a direct API caller), falls back to the original behavior: matching
 * each field's own name against the file's headers, case-insensitively.
 * Within a supplied mapping, a field mapped to `null` (or left out) means
 * "don't import this field" — never auto-detected as a fallback, so a user
 * who explicitly unmapped a column doesn't have it silently reappear.
 */
function getField(row: Record<string, string>, key: string, mapping?: CandidateImportColumnMapping): string | undefined {
  if (mapping) {
    const mappedColumn = mapping[key];
    const value = mappedColumn ? row[mappedColumn]?.trim() : undefined;
    return value ? value : undefined;
  }

  const foundKey = Object.keys(row).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  const value = foundKey ? row[foundKey]?.trim() : undefined;
  return value ? value : undefined;
}

function splitList(value: string | undefined): string[] {
  return value
    ? value
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

/**
 * `consentGivenAt` is never fabricated — a row whose file doesn't supply a
 * real value (via the mapping, or auto-detection) is left undefined, which
 * candidateCreateSchema then rejects as invalid (no consent timestamp may
 * be invented on a candidate's behalf, per §13's GDPR-aligned consent
 * capture).
 */
function mapImportRow(row: Record<string, string>, mapping?: CandidateImportColumnMapping): Record<string, unknown> {
  const numberField = (value: string | undefined) => (value ? Number(value) : undefined);
  const field = (key: string) => getField(row, key, mapping);

  return {
    name: field("name"),
    phone: field("phone"),
    email: field("email"),
    location: field("location"),
    currentCompensation: numberField(field("currentCompensation")),
    expectedCompensation: numberField(field("expectedCompensation")),
    noticePeriodDays: numberField(field("noticePeriodDays")),
    earliestAvailability: field("earliestAvailability"),
    totalExperienceYears: numberField(field("totalExperienceYears")),
    skills: splitList(field("skills")),
    tags: splitList(field("tags")),
    sourceId: field("sourceId"),
    consentGivenAt: field("consentGivenAt"),
  };
}

export type CandidateImportPreviewRow =
  | { row: number; data: Record<string, unknown>; status: "invalid"; errors: string[] }
  | { row: number; data: Record<string, unknown>; status: "duplicate"; existingCandidateId: string }
  | { row: number; data: Record<string, unknown>; status: "valid" };

/**
 * Parses and validates every row; writes nothing — the Phase 2 stateless
 * preview/commit design. `mapping` is the user-confirmed column mapping
 * from the column-mapping step (§11.2's "map their file's own headers to
 * expected fields" gap) — omitted, it falls back to matching each field's
 * name against the file's headers directly, same as before that step
 * existed.
 */
export async function previewCandidateImport(
  context: SessionContext,
  buffer: Buffer,
  fileName: string,
  mapping?: CandidateImportColumnMapping,
): Promise<{ rows: CandidateImportPreviewRow[] }> {
  await requirePermission(context, ENTITY.CANDIDATE, "CREATE");

  const rawRows = fileName.toLowerCase().endsWith(".csv")
    ? parseCsv(buffer.toString("utf-8"))
    : await parseXlsx(buffer);

  const results: CandidateImportPreviewRow[] = [];
  // Tracks phones already marked "valid" earlier in this same file — a hard
  // duplicate check against the database alone would miss two rows in one
  // file sharing a phone, showing both as "valid" when committing would
  // only ever create the first (see commitCandidateImport's per-row
  // DuplicateCandidateError handling).
  const seenPhones = new Map<string, number>();

  for (let i = 0; i < rawRows.length; i++) {
    const mapped = mapImportRow(rawRows[i], mapping);
    const parsed = candidateCreateSchema.safeParse(mapped);

    if (!parsed.success) {
      results.push({
        row: i + 1,
        data: mapped,
        status: "invalid",
        errors: parsed.error.issues.map((issue) => issue.message),
      });
      continue;
    }

    const seenAtRow = seenPhones.get(parsed.data.phone);
    if (seenAtRow !== undefined) {
      results.push({
        row: i + 1,
        data: parsed.data,
        status: "invalid",
        errors: [`Duplicate phone with row ${seenAtRow} in this file.`],
      });
      continue;
    }

    const hardMatch = await prisma.candidate.findUnique({ where: { phone: parsed.data.phone } });
    if (hardMatch) {
      results.push({ row: i + 1, data: parsed.data, status: "duplicate", existingCandidateId: hardMatch.id });
      continue;
    }

    seenPhones.set(parsed.data.phone, i + 1);
    results.push({ row: i + 1, data: parsed.data, status: "valid" });
  }

  return { rows: results };
}

/** Re-validates and re-checks duplicates server-side rather than trusting the previewed rows. */
export async function commitCandidateImport(context: SessionContext, input: CandidateImportCommitInput) {
  await requirePermission(context, ENTITY.CANDIDATE, "CREATE");

  const created = [];
  const skipped: { row: number; reason: string; existingCandidateId?: string }[] = [];

  for (let i = 0; i < input.rows.length; i++) {
    try {
      created.push(await createCandidate(context, input.rows[i]));
    } catch (error) {
      if (error instanceof DuplicateCandidateError) {
        skipped.push({ row: i + 1, reason: error.message, existingCandidateId: error.existingCandidateId });
      } else {
        throw error;
      }
    }
  }

  return { created, skipped };
}
