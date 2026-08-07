import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { ENTITY } from "@/lib/entity-registry";
import type { SessionContext } from "@/lib/authz/session-context";
import { recordAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { REPORT_QUERY_SCHEMAS } from "@/lib/validations/report";
import type { ReportExportQuery } from "@/lib/validations/report";
import {
  getOfferTatComplianceReport,
  getPipelineFunnelReport,
  getRecruiterProductivityReport,
  getTimeToFillOfferReport,
} from "@/lib/services/reports";

type ExportRow = Record<string, string | number>;

function formatDays(value: number | null): string {
  return value === null ? "" : value.toFixed(1);
}

function formatRate(value: number | null): string {
  return value === null ? "" : `${(value * 100).toFixed(0)}%`;
}

/** One tabular shape per report type — the export's whole job is flattening each report's own return shape into rows any of the three formats below can render identically. */
async function buildReportRows(
  context: SessionContext,
  reportType: ReportExportQuery["reportType"],
  filters: Record<string, unknown>,
): Promise<{ title: string; rows: ExportRow[] }> {
  switch (reportType) {
    case "PIPELINE_FUNNEL": {
      const query = REPORT_QUERY_SCHEMAS.PIPELINE_FUNNEL.parse(filters);
      const report = await getPipelineFunnelReport(context, query);
      return {
        title: `Pipeline Funnel - ${report.job.title}`,
        rows: report.stages.map((stage) => ({
          Stage: stage.name,
          "Current Count": stage.currentCount,
          "Reached Count": stage.reachedCount,
          "Conversion From Previous": formatRate(stage.conversionFromPrevious),
        })),
      };
    }
    case "TIME_TO_FILL_AND_OFFER": {
      const query = REPORT_QUERY_SCHEMAS.TIME_TO_FILL_AND_OFFER.parse(filters);
      const report = await getTimeToFillOfferReport(context, query);
      return {
        title: "Time to Fill and Time to Offer",
        rows: report.jobs.map((job) => ({
          Job: job.title,
          Department: job.departmentLabel,
          "Time to Fill (avg business days)": formatDays(job.timeToFillDaysAvg),
          Hires: job.hiresCount,
          "Time to Offer (avg business days)": formatDays(job.timeToOfferDaysAvg),
          Offers: job.offersCount,
        })),
      };
    }
    case "RECRUITER_PRODUCTIVITY": {
      const query = REPORT_QUERY_SCHEMAS.RECRUITER_PRODUCTIVITY.parse(filters);
      const report = await getRecruiterProductivityReport(context, query);
      return {
        title: "Recruiter Productivity and Workload",
        rows: report.rows.map((row) => ({
          Recruiter: row.recruiter.name,
          "Open Jobs": row.openJobsCount,
          "Active Applications": row.activeApplicationsCount,
          "Interviews Scheduled": row.interviewsScheduledCount,
          "Offers Extended": row.offersExtendedCount,
          Hires: row.hiresCount,
        })),
      };
    }
    case "OFFER_TAT_COMPLIANCE": {
      const query = REPORT_QUERY_SCHEMAS.OFFER_TAT_COMPLIANCE.parse(filters);
      const report = await getOfferTatComplianceReport(context, query);
      return {
        title: `Offer TAT Compliance (threshold: ${report.tatThresholdDays} business days)`,
        rows: report.rows.map((row) => ({
          "Offer ID": row.offerId,
          Recruiter: row.recruiter?.name ?? "",
          "TAT (business days)": row.tatDays,
          Compliant: row.compliant ? "Yes" : "No",
        })),
      };
    }
  }
}

async function toXlsxBuffer(title: string, rows: ExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  // Excel worksheet names cap at 31 characters.
  const worksheet = workbook.addWorksheet(title.slice(0, 31));
  if (rows.length > 0) {
    worksheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key }));
    rows.forEach((row) => worksheet.addRow(row));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsvBuffer(rows: ExportRow[]): Buffer {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(","));
  }
  return Buffer.from(lines.join("\n"), "utf-8");
}

/**
 * A plain pipe-delimited text table, not a laid-out grid with column
 * widths/borders — pdf-lib is a low-level PDF-writing library with no table
 * layout of its own, and building a full layout engine is out of scope for
 * this pass. Good enough to satisfy "export to PDF" (§11.12) for a report
 * that's already viewable on-screen and exportable as XLSX/CSV.
 */
async function toPdfBuffer(title: string, rows: ExportRow[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  const pageWidth = 792;
  const pageHeight = 612;
  const margin = 36;
  const lineHeight = 16;
  const fontSize = 9;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawLine = (text: string, bold = false) => {
    if (y < margin + lineHeight) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(text, { x: margin, y, size: fontSize, font: bold ? boldFont : font });
    y -= lineHeight;
  };

  page.drawText(title, { x: margin, y, size: 14, font: boldFont });
  y -= lineHeight * 2;

  if (headers.length === 0) {
    drawLine("No data for the selected filters.");
  } else {
    drawLine(headers.join("   |   "), true);
    for (const row of rows) {
      drawLine(headers.map((header) => String(row[header] ?? "")).join("   |   "));
    }
  }

  return Buffer.from(await pdfDoc.save());
}

export async function renderReportBuffer(context: SessionContext, query: ReportExportQuery) {
  const { title, rows } = await buildReportRows(context, query.reportType, query.filters);

  let buffer: Buffer;
  let mimeType: string;
  if (query.format === "XLSX") {
    buffer = await toXlsxBuffer(title, rows);
    mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else if (query.format === "CSV") {
    buffer = toCsvBuffer(rows);
    mimeType = "text/csv";
  } else {
    buffer = await toPdfBuffer(title, rows);
    mimeType = "application/pdf";
  }

  const fileName = `${query.reportType.toLowerCase()}-report.${query.format.toLowerCase()}`;
  return { buffer, mimeType, fileName, rowCount: rows.length };
}

/** Ad-hoc export via the reports UI — reuses candidate-export.ts's "reuse the entity's own :READ, always audit-logged" pattern, logged here against SAVED_REPORT since no single business record anchors an arbitrary report export. */
export async function exportReport(context: SessionContext, query: ReportExportQuery) {
  const result = await renderReportBuffer(context, query);

  await recordAudit({
    actorId: context.userId,
    action: AUDIT_ACTIONS.REPORT_EXPORTED,
    entityType: ENTITY.SAVED_REPORT,
    entityId: "ad-hoc-export",
    changes: { after: { reportType: query.reportType, format: query.format, rowCount: result.rowCount } },
  });

  return result;
}
