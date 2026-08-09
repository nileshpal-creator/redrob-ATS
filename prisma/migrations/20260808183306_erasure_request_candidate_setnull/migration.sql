-- DropForeignKey
ALTER TABLE "DataErasureRequest" DROP CONSTRAINT "DataErasureRequest_candidateId_fkey";

-- AlterTable
ALTER TABLE "DataErasureRequest" ALTER COLUMN "candidateId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "DataErasureRequest" ADD CONSTRAINT "DataErasureRequest_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
