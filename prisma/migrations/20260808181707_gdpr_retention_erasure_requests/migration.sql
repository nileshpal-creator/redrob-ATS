-- CreateEnum
CREATE TYPE "DataErasureMethod" AS ENUM ('ANONYMIZE', 'HARD_DELETE');

-- CreateEnum
CREATE TYPE "DataErasureRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED');

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "candidateRetentionDays" INTEGER;

-- CreateTable
CREATE TABLE "DataErasureRequest" (
    "id" TEXT NOT NULL,
    "method" "DataErasureMethod" NOT NULL,
    "status" "DataErasureRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "candidateId" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNotes" TEXT,

    CONSTRAINT "DataErasureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataErasureRequest_candidateId_idx" ON "DataErasureRequest"("candidateId");

-- CreateIndex
CREATE INDEX "DataErasureRequest_status_idx" ON "DataErasureRequest"("status");

-- AddForeignKey
ALTER TABLE "DataErasureRequest" ADD CONSTRAINT "DataErasureRequest_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataErasureRequest" ADD CONSTRAINT "DataErasureRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataErasureRequest" ADD CONSTRAINT "DataErasureRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
