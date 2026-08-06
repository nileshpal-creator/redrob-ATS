/*
  Warnings:

  - You are about to drop the column `code` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `hiringManagerId` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `salaryMax` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `salaryMin` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `salaryVisible` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `sequenceNumber` on the `Job` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_hiringManagerId_fkey";

-- DropIndex
DROP INDEX "Job_code_key";

-- DropIndex
DROP INDEX "Job_hiringManagerId_idx";

-- DropIndex
DROP INDEX "Job_sequenceNumber_key";

-- AlterTable
ALTER TABLE "Job" DROP COLUMN "code",
DROP COLUMN "currency",
DROP COLUMN "hiringManagerId",
DROP COLUMN "salaryMax",
DROP COLUMN "salaryMin",
DROP COLUMN "salaryVisible",
DROP COLUMN "sequenceNumber";
