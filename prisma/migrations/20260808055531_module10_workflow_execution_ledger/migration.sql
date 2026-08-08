-- CreateEnum
CREATE TYPE "WorkflowExecutionStatus" AS ENUM ('SUCCESS', 'PARTIAL_FAILURE', 'FAILED');

-- CreateTable
CREATE TABLE "WorkflowExecution" (
    "id" TEXT NOT NULL,
    "workflowDefinitionVersionId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "WorkflowExecutionStatus" NOT NULL,
    "actionsSummary" JSONB NOT NULL,
    "errorMessage" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowExecution_applicationId_idx" ON "WorkflowExecution"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowExecution_workflowDefinitionVersionId_applicationId_key" ON "WorkflowExecution"("workflowDefinitionVersionId", "applicationId", "fingerprint");

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_workflowDefinitionVersionId_fkey" FOREIGN KEY ("workflowDefinitionVersionId") REFERENCES "WorkflowDefinitionVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
