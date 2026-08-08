-- CreateEnum
CREATE TYPE "InterviewReminderRecipientType" AS ENUM ('CANDIDATE', 'PANELIST');

-- CreateEnum
CREATE TYPE "InterviewReminderStatus" AS ENUM ('PROCESSING', 'SENT', 'RETRYING', 'FAILED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "interviewReminderLeadMinutes" INTEGER[] DEFAULT ARRAY[1440, 60]::INTEGER[];

-- CreateTable
CREATE TABLE "InterviewReminder" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "scheduledAtFingerprint" TEXT NOT NULL,
    "leadMinutes" INTEGER NOT NULL,
    "recipientType" "InterviewReminderRecipientType" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "toEmail" TEXT,
    "status" "InterviewReminderStatus" NOT NULL DEFAULT 'PROCESSING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewReminder_status_nextAttemptAt_idx" ON "InterviewReminder"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewReminder_interviewId_scheduledAtFingerprint_leadMi_key" ON "InterviewReminder"("interviewId", "scheduledAtFingerprint", "leadMinutes", "recipientId");

-- AddForeignKey
ALTER TABLE "InterviewReminder" ADD CONSTRAINT "InterviewReminder_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
