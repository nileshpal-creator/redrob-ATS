-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('PIPELINE_FUNNEL', 'TIME_TO_FILL_AND_OFFER', 'RECRUITER_PRODUCTIVITY', 'OFFER_TAT_COMPLIANCE');

-- CreateEnum
CREATE TYPE "ReportExportFormat" AS ENUM ('XLSX', 'CSV', 'PDF');

-- CreateEnum
CREATE TYPE "ReportScheduleFrequency" AS ENUM ('NONE', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "scheduleFrequency" "ReportScheduleFrequency" NOT NULL DEFAULT 'NONE',
    "recipientEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exportFormat" "ReportExportFormat" NOT NULL DEFAULT 'XLSX',
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" "ReportRunStatus",
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedReport_createdById_idx" ON "SavedReport"("createdById");

-- CreateIndex
CREATE INDEX "SavedReport_scheduleFrequency_lastRunAt_idx" ON "SavedReport"("scheduleFrequency", "lastRunAt");

-- AddForeignKey
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
