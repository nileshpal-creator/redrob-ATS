-- CreateEnum
CREATE TYPE "JobApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ApprovalEntityType" AS ENUM ('JOB', 'OFFER');

-- AlterEnum
ALTER TYPE "InterviewStatus" ADD VALUE 'NO_SHOW';

-- AlterEnum
ALTER TYPE "OfferApprovalStatus" ADD VALUE 'SKIPPED';

-- AlterEnum
ALTER TYPE "OfferStatus" ADD VALUE 'LAPSED';

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "respondByDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OfferApproval" ADD COLUMN     "requiredRoleId" TEXT,
ADD COLUMN     "requiredRoleName" TEXT,
ADD COLUMN     "stepName" TEXT,
ADD COLUMN     "stepOrder" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "offerTatThresholdDays" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "JobApproval" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL DEFAULT 1,
    "stepName" TEXT,
    "requiredRoleId" TEXT,
    "requiredRoleName" TEXT,
    "status" "JobApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "comments" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStepConfig" (
    "id" TEXT NOT NULL,
    "entityType" "ApprovalEntityType" NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "requiredRoleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalStepConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobApproval_jobId_idx" ON "JobApproval"("jobId");

-- CreateIndex
CREATE INDEX "JobApproval_jobId_stepOrder_idx" ON "JobApproval"("jobId", "stepOrder");

-- CreateIndex
CREATE INDEX "ApprovalStepConfig_entityType_idx" ON "ApprovalStepConfig"("entityType");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStepConfig_entityType_stepOrder_key" ON "ApprovalStepConfig"("entityType", "stepOrder");

-- CreateIndex
CREATE INDEX "OfferApproval_offerId_stepOrder_idx" ON "OfferApproval"("offerId", "stepOrder");

-- AddForeignKey
ALTER TABLE "JobApproval" ADD CONSTRAINT "JobApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApproval" ADD CONSTRAINT "JobApproval_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStepConfig" ADD CONSTRAINT "ApprovalStepConfig_requiredRoleId_fkey" FOREIGN KEY ("requiredRoleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
