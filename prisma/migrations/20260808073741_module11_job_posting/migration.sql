-- CreateEnum
CREATE TYPE "JobPostingStatus" AS ENUM ('POSTED', 'REMOVED', 'FAILED');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "sourcedFromPostingId" TEXT;

-- CreateTable
CREATE TABLE "JobPosting" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "JobPostingStatus" NOT NULL DEFAULT 'POSTED',
    "externalPostingId" TEXT,
    "errorMessage" TEXT,
    "postedById" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobPosting_jobId_idx" ON "JobPosting"("jobId");

-- CreateIndex
CREATE INDEX "JobPosting_sourceId_idx" ON "JobPosting"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "JobPosting_jobId_sourceId_key" ON "JobPosting"("jobId", "sourceId");

-- CreateIndex
CREATE INDEX "Application_sourcedFromPostingId_idx" ON "Application"("sourcedFromPostingId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_sourcedFromPostingId_fkey" FOREIGN KEY ("sourcedFromPostingId") REFERENCES "JobPosting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ControlledListValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
