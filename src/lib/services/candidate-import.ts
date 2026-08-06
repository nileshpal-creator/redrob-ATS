import ExcelJS from "exceljs";

import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import { requirePermission } from "@/lib/authz/authorize";
import type { SessionContext } from "@/lib/authz/session-context";
import { DuplicateCandidateError } from "@/lib/errors";
import { candidateCreateSchema, type CandidateImportCommitInput } from "@/lib/validations/candidate";
import { createCandidate } from "./candidates";

/** Bulk import (§11.2, sequenced after core CRUD per the Phase 1 decision). */

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const parseLine = (line: string): string[] => {
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
  };

  const headers = parseLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });
}

async function parseXlsx(buffer: Buffer): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

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

function getField(row: Record<string, string>, key: string): string | undefined {
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
 * Expected columns (case-insensitive): name, phone, email, location,
 * currentCompensation, expectedCompensation, noticePeriodDays,
 * earliestAvailability, totalExperienceYears, skills, tags, sourceId,
 * consentGivenAt. `consentGivenAt` defaults to the time of import if the
 * file doesn't include it — an explicit assumption, see Phase 3 write-up.
 */
function mapImportRow(row: Record<string, string>): Record<string, unknown> {
  const numberField = (value: string | undefined) => (value ? Number(value) : undefined);

  return {
    name: getField(row, "name"),
    phone: getField(row, "phone"),
    email: getField(row, "email"),
    location: getField(row, "location"),
    currentCompensation: numberField(getField(row, "currentCompensation")),
    expectedCompensation: numberField(getField(row, "expectedCompensation")),
    noticePeriodDays: numberField(getField(row, "noticePeriodDays")),
    earliestAvailability: getField(row, "earliestAvailability"),
    totalExperienceYears: numberField(getField(row, "totalExperienceYears")),
    skills: splitList(getField(row, "skills")),
    tags: splitList(getField(row, "tags")),
    sourceId: getField(row, "sourceId"),
    consentGivenAt: getField(row, "consentGivenAt") ?? new Date().toISOString(),
  };
}

export type CandidateImportPreviewRow =
  | { row: number; data: Record<string, unknown>; status: "invalid"; errors: string[] }
  | { row: number; data: Record<string, unknown>; status: "duplicate"; existingCandidateId: string }
  | { row: number; data: Record<string, unknown>; status: "valid" };

/** Parses and validates every row; writes nothing — the Phase 2 stateless preview/commit design. */
export async function previewCandidateImport(
  context: SessionContext,
  buffer: Buffer,
  fileName: string,
): Promise<{ rows: CandidateImportPreviewRow[] }> {
  await requirePermission(context, ENTITY.CANDIDATE, "CREATE");

  const rawRows = fileName.toLowerCase().endsWith(".csv")
    ? parseCsv(buffer.toString("utf-8"))
    : await parseXlsx(buffer);

  const results: CandidateImportPreviewRow[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const mapped = mapImportRow(rawRows[i]);
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

    const hardMatch = await prisma.candidate.findUnique({ where: { phone: parsed.data.phone } });
    if (hardMatch) {
      results.push({ row: i + 1, data: parsed.data, status: "duplicate", existingCandidateId: hardMatch.id });
      continue;
    }

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
