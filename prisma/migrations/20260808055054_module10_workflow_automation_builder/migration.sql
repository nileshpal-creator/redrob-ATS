-- CreateEnum
CREATE TYPE "WorkflowTriggerType" AS ENUM ('STAGE_CHANGE', 'FIELD_UPDATE', 'TIME_IN_STAGE', 'FORM_SUBMISSION');

-- CreateEnum
CREATE TYPE "WorkflowActionType" AS ENUM ('SEND_EMAIL', 'CREATE_TASK', 'CHANGE_FIELD', 'REASSIGN_OWNER', 'REQUEST_APPROVAL');

-- CreateEnum
CREATE TYPE "WorkflowTaskStatus" AS ENUM ('OPEN', 'DONE', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activeVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDefinitionVersion" (
    "id" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "triggerType" "WorkflowTriggerType" NOT NULL,
    "triggerConfig" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowDefinitionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTask" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedToId" TEXT NOT NULL,
    "status" "WorkflowTaskStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3),
    "sourceVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_activeVersionId_key" ON "WorkflowDefinition"("activeVersionId");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_jobId_isActive_idx" ON "WorkflowDefinition"("jobId", "isActive");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_createdById_idx" ON "WorkflowDefinition"("createdById");

-- CreateIndex
CREATE INDEX "WorkflowDefinitionVersion_workflowDefinitionId_idx" ON "WorkflowDefinitionVersion"("workflowDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinitionVersion_workflowDefinitionId_versionNumbe_key" ON "WorkflowDefinitionVersion"("workflowDefinitionId", "versionNumber");

-- CreateIndex
CREATE INDEX "WorkflowTask_applicationId_idx" ON "WorkflowTask"("applicationId");

-- CreateIndex
CREATE INDEX "WorkflowTask_assignedToId_status_idx" ON "WorkflowTask"("assignedToId", "status");

-- AddForeignKey
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "WorkflowDefinitionVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDefinitionVersion" ADD CONSTRAINT "WorkflowDefinitionVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDefinitionVersion" ADD CONSTRAINT "WorkflowDefinitionVersion_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTask" ADD CONSTRAINT "WorkflowTask_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "WorkflowDefinitionVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
