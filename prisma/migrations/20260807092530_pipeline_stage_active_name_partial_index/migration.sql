-- DropIndex
DROP INDEX "PipelineStage_jobId_name_key";

-- Uniqueness on (jobId, name) should only apply among active stages — a
-- full constraint would permanently reserve a deactivated stage's name.
-- Not representable in schema.prisma (no partial-index syntax), so this
-- is hand-written, same pattern as job_recruiter_one_primary.
CREATE UNIQUE INDEX "pipeline_stage_active_name_unique"
  ON "PipelineStage" ("jobId", "name")
  WHERE "isActive" = true;
