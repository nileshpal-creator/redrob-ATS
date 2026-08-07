-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('PENDING', 'DELIVERED', 'ACCEPTED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "HandoffDeliveryMethod" AS ENUM ('API_PUSH', 'STRUCTURED_EXPORT');

-- CreateTable
CREATE TABLE "HandoffRecord" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryMethod" "HandoffDeliveryMethod" NOT NULL,
    "payload" JSONB NOT NULL,
    "externalReferenceId" TEXT,
    "exceptionReason" TEXT,
    "customFields" JSONB,
    "initiatedById" TEXT NOT NULL,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoffRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoffDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "handoffRecordId" TEXT NOT NULL,
    "deliveryMethod" "HandoffDeliveryMethod" NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "externalReferenceId" TEXT,
    "errorMessage" TEXT,
    "attemptedById" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoffDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HandoffRecord_offerId_key" ON "HandoffRecord"("offerId");

-- CreateIndex
CREATE INDEX "HandoffRecord_applicationId_idx" ON "HandoffRecord"("applicationId");

-- CreateIndex
CREATE INDEX "HandoffRecord_status_idx" ON "HandoffRecord"("status");

-- CreateIndex
CREATE INDEX "HandoffDeliveryAttempt_handoffRecordId_idx" ON "HandoffDeliveryAttempt"("handoffRecordId");

-- AddForeignKey
ALTER TABLE "HandoffRecord" ADD CONSTRAINT "HandoffRecord_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffRecord" ADD CONSTRAINT "HandoffRecord_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffRecord" ADD CONSTRAINT "HandoffRecord_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffRecord" ADD CONSTRAINT "HandoffRecord_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffDeliveryAttempt" ADD CONSTRAINT "HandoffDeliveryAttempt_attemptedById_fkey" FOREIGN KEY ("attemptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffDeliveryAttempt" ADD CONSTRAINT "HandoffDeliveryAttempt_handoffRecordId_fkey" FOREIGN KEY ("handoffRecordId") REFERENCES "HandoffRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
