-- CreateEnum
CREATE TYPE "CommunicationTemplateVersionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "preferredLanguage" TEXT;

-- CreateTable
CREATE TABLE "CommunicationTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommunicationTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comments" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunicationTemplateVersion_templateId_language_status_idx" ON "CommunicationTemplateVersion"("templateId", "language", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationTemplateVersion_templateId_language_versionNum_key" ON "CommunicationTemplateVersion"("templateId", "language", "versionNumber");

-- AddForeignKey
ALTER TABLE "CommunicationTemplateVersion" ADD CONSTRAINT "CommunicationTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CommunicationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationTemplateVersion" ADD CONSTRAINT "CommunicationTemplateVersion_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationTemplateVersion" ADD CONSTRAINT "CommunicationTemplateVersion_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationTemplateVersion" ADD CONSTRAINT "CommunicationTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
