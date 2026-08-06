import ExcelJS from "exceljs";

import { prisma } from "@/lib/prisma";
import { ENTITY } from "@/lib/entity-registry";
import type { SessionContext } from "@/lib/authz/session-context";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import type { CandidateExportQuery } from "@/lib/validations/candidate";
import { buildCandidateScopedWhere, candidateListInclude } from "./candidates";

/** Export (§11.2) — reuses CANDIDATE:READ (decision g), always audit-logged. */

function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toExportRow(candidate: {
  name: string;
  phone: string;
  email: string | null;
  location: string | null;
  currentCompensation: unknown;
  expectedCompensation: unknown;
  noticePeriodDays: number | null;
  earliestAvailability: Date | null;
  totalExperienceYears: unknown;
  skills: string[];
  tags: string[];
  source: { label: string } | null;
  createdAt: Date;
}) {
  return {
    Name: candidate.name,
    Phone: candidate.phone,
    Email: candidate.email ?? "",
    Location: candidate.location ?? "",
    "Current Compensation": candidate.currentCompensation ? String(candidate.currentCompensation) : "",
    "Expected Compensation": candidate.expectedCompensation ? String(candidate.expectedCompensation) : "",
    "Notice Period (days)": candidate.noticePeriodDays ?? "",
    "Earliest Availability": candidate.earliestAvailability?.toISOString().slice(0, 10) ?? "",
    "Experience (years)": candidate.totalExperienceYears ? String(candidate.totalExperienceYears) : "",
    Skills: candidate.skills.join("; "),
    Tags: candidate.tags.join("; "),
    Source: candidate.source?.label ?? "",
    "Created At": candidate.createdAt.toISOString(),
  };
}

export async function exportCandidates(context: SessionContext, query: CandidateExportQuery) {
  // buildCandidateScopedWhere enforces the permission check itself (via
  // getEffectiveScope, throwing ForbiddenError if the caller has no grant at
  // all) — a bare requirePermission() here would wrongly reject a plain
  // OWN/TEAM-scope grant, since export isn't checked against one record.
  const where = await buildCandidateScopedWhere(context, query);
  const candidates = await prisma.candidate.findMany({
    where,
    include: candidateListInclude,
    orderBy: { createdAt: "desc" },
  });
  const rows = candidates.map(toExportRow);

  let buffer: Buffer;
  let mimeType: string;
  const fileName = `candidates-export.${query.format}`;

  if (query.format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Candidates");
    if (rows.length > 0) {
      worksheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key }));
      rows.forEach((row) => worksheet.addRow(row));
    }
    buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else {
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map((header) => escapeCsvCell((row as Record<string, unknown>)[header])).join(","));
    }
    buffer = Buffer.from(lines.join("\n"), "utf-8");
    mimeType = "text/csv";
  }

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.CANDIDATE_EXPORTED,
    entityType: ENTITY.CANDIDATE,
    entityId: "bulk-export",
    changes: { after: { format: query.format, count: candidates.length } },
  });

  return { buffer, mimeType, fileName };
}
